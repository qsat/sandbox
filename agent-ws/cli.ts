#!/usr/bin/env bun
/**
 * agent-ws — ghq 管理下のリポジトリ > worktree > プロセス を、AI エージェントの応答状況つきで表示する
 *
 *   agent-ws [list] [query] [--all] [--agents-only] [--json]  一覧を1回表示
 *   agent-ws watch [query] [--all] [--interval=2] [--popup]   常駐表示。j/k で選択、Enter でそのペインへ移動
 *   agent-ws status [--tmux]                                  ステータスライン用の印（⏳ 許可待ち / ❓ 質問待ち / ✓ 完了して未確認 / ✗ エラー）
 *   agent-ws seen <pane_pid>                                  そのペインで完了したものを既読にする（tmux の pane-focus-in から呼ぶ）
 *   agent-ws jump <pid|path> [--create] [--dry-run]           その pid / パスがいる tmux ペインへ移動
 *   agent-ws hook                                             Claude Code の hook から呼ばれる（stdin に JSON）
 *   agent-ws hooks-config                                     ~/.claude/settings.json に足す hooks 設定を出力
 *
 * 環境変数: AGENT_WS_NOTIFY（通知する状態。既定 waiting,asking,ready,error。空で通知しない）/ AGENT_WS_STATE_DIR / GHQ_ROOT
 *           AGENT_WS_DUMP（hook の入力をそのまま追記するファイル。入力の形を確かめるとき用）
 *
 * 構成（依存は矢印の向きだけ）:
 *   cli.ts ─┬→ app/intents（意図のアクション）・app/store
 *           │     app/effects（listener）─┬→ domain/*   集約・スライス・selector（純粋）
 *           │     app/claude（境界）──────┴→ infra/*    ログ・git・プロセス・tmux
 *           └→ ui/*  ──────────→ domain/*  行モデル（view）・色（terminal）・対話（watch）
 */
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import type { HookInput } from "./src/app/claude.ts";
import { hooksConfig } from "./src/app/claude.ts";
import * as intent from "./src/app/intents.ts";
import { createAppStore, type AppStore } from "./src/app/store.ts";
import type { JumpResult, JumpTarget } from "./src/domain/model.ts";
import { allSessions, statusFlags } from "./src/domain/sessions.ts";
import { selectTree } from "./src/domain/workspace.ts";
import { ghqRoots } from "./src/infra/git.ts";
import { notify } from "./src/infra/notify.ts";
import { realPath } from "./src/infra/shell.ts";
import type { ColorMode } from "./src/ui/terminal.ts";
import { formatCells, formatRow } from "./src/ui/terminal.ts";
import { jumpMessage, notification, statusLine, treeRows } from "./src/ui/view.ts";
import { runWatch } from "./src/ui/watch.ts";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    "agents-only": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    tmux: { type: "boolean", default: false },
    popup: { type: "boolean", default: false },
    create: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    interval: { type: "string", default: "2" },
  },
});
const COMMANDS = ["list", "watch", "status", "seen", "jump", "hook", "hooks-config"];
const [command, arg] = COMMANDS.includes(positionals[0] ?? "") ? positionals : ["list", ...positionals];
const color: ColorMode = process.stdout.isTTY || process.env.FORCE_COLOR === "1" ? "ansi" : "none";
const filter = { all: opt.all, agentsOnly: opt["agents-only"] };

/** ログから組み立てたセッションを持つ Store */
function sessionStore(): AppStore {
  const store = createAppStore();
  store.dispatch(intent.sessionsRequested());
  store.dispatch(intent.settleRequested({ at: Date.now() }));
  return store;
}

/** 移動を頼み、結果を Store から読む（listener は dispatch の中で終わる） */
function jump(store: AppStore, target: JumpTarget, o: { create: boolean; dryRun?: boolean }): JumpResult {
  store.dispatch(intent.jumpRequested({ target, ...o }));
  return store.getState().navigation.lastJump ?? { kind: "failed", title: target.title };
}

const tree = (store: AppStore, roots: string[], compact: boolean) => {
  const st = store.getState();
  const repos = selectTree(st.workspace, allSessions(st.sessions), filter, process.pid);
  return { repos, rows: treeRows(repos, { compact, roots, home: homedir(), now: Date.now() }) };
};

switch (command) {
  case "list": {
    const roots = ghqRoots();
    const store = sessionStore();
    store.dispatch(intent.reposRequested({ roots, query: arg }));
    store.dispatch(intent.processesRequested());
    store.dispatch(intent.dirtyRequested({ filter }));
    const { repos, rows } = tree(store, roots, false);
    if (opt.json) console.log(JSON.stringify(repos, null, 2));
    else for (const row of rows) console.log(formatRow(row, process.stdout.columns ?? 160, color));
    break;
  }

  case "watch": {
    const roots = ghqRoots();
    const store = sessionStore();
    runWatch({
      rows: () => tree(store, roots, true).rows,
      subscribe: (onChange) => void store.subscribe(onChange),
      jump: (target) => {
        const r = jump(store, target, { create: true });
        return { ok: r.kind === "focused" || r.kind === "created", message: jumpMessage(r) };
      },
      reload: () => store.dispatch(intent.reposRequested({ roots, query: arg })),
      exitOnJump: opt.popup,
      color,
    });
    store.dispatch(intent.watchStarted({ roots, query: arg, filter, intervalMs: Number(opt.interval) * 1000 }));
    break;
  }

  case "status": {
    const st = sessionStore().getState();
    console.log(formatCells(statusLine(statusFlags(allSessions(st.sessions))), opt.tmux ? "tmux" : color));
    break;
  }

  case "seen":
    if (/^\d+$/.test(arg ?? "")) {
      const store = createAppStore();
      store.dispatch(intent.sessionsRequested());
      store.dispatch(intent.seenInPaneRequested({ panePid: Number(arg), at: Date.now() }));
    }
    break;

  case "jump": {
    const target: JumpTarget = /^\d+$/.test(arg ?? "")
      ? { title: `pid ${arg}`, name: `pid ${arg}`, pid: Number(arg) }
      : { title: arg ?? ".", name: arg ?? ".", path: realPath(arg ?? process.cwd()) };
    const r = jump(sessionStore(), target, { create: opt.create, dryRun: opt["dry-run"] });
    console.log(formatCells([jumpMessage(r)], color));
    process.exitCode = r.kind === "notFound" || r.kind === "failed" ? 1 : 0;
    break;
  }

  case "hook": {
    // 失敗しても Claude Code の動作は止めない
    try {
      const input = await Bun.stdin.text();
      // 入力の確認用: 受け取った JSON をそのまま1行ずつ追記する
      if (process.env.AGENT_WS_DUMP) appendFileSync(process.env.AGENT_WS_DUMP, `${input.replace(/\n/g, " ")}\n`);
      const notifyOn = (process.env.AGENT_WS_NOTIFY ?? "waiting,asking,ready,error").split(",");
      const store = createAppStore({
        onNotice: (n) => {
          if (!notifyOn.includes(n.kind)) return;
          const { title, body } = notification(n);
          notify(title, body);
        },
      });
      store.dispatch(intent.hookReceived({ input: JSON.parse(input || "{}") as HookInput, at: Date.now() }));
    } catch { /* 無視 */ }
    break;
  }

  case "hooks-config":
    console.log(JSON.stringify(hooksConfig(process.execPath, realPath(process.argv[1])), null, 2));
    break;
}
