#!/usr/bin/env bun
/**
 * agent-ws — ghq 管理下のリポジトリ > worktree > プロセス を、AI エージェントの応答状況つきで表示する
 *
 *   agent-ws [list] [query] [--all] [--agents-only] [--json]  一覧を1回表示
 *   agent-ws watch [query] [--all] [--interval=2] [--popup]   常駐表示。j/k で選択、Enter でそのペインへ移動
 *   agent-ws status [--tmux]                                  ステータスライン用の1行
 *   agent-ws jump <pid|path> [--create] [--dry-run]           その pid / パスがいる tmux ペインへ移動
 *   agent-ws hook                                             Claude Code の hook から呼ばれる（stdin に JSON）
 *   agent-ws hooks-config                                     ~/.claude/settings.json に足す hooks 設定を出力
 *
 * 環境変数: AGENT_WS_NOTIFY（通知する状態。既定 waiting,ready,error。空で通知しない）/ AGENT_WS_STATE_DIR / GHQ_ROOT
 *
 * 構成（依存は矢印の向きだけ）:
 *   cli.ts ─┬→ app.ts ─┬→ domain.ts   型と純粋なルール
 *           │          └→ infra/*     git・プロセス・状態ファイル・tmux
 *           └→ ui/*  ───→ domain.ts   行モデル（view）・色（terminal）・対話（watch）
 */
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import * as app from "./src/app.ts";
import type { HookEvent, JumpTarget } from "./src/domain.ts";
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
const COMMANDS = ["list", "watch", "status", "jump", "hook", "hooks-config"];
const [command, arg] = COMMANDS.includes(positionals[0] ?? "") ? positionals : ["list", ...positionals];
const color: ColorMode = process.stdout.isTTY || process.env.FORCE_COLOR === "1" ? "ansi" : "none";
const filter = { all: opt.all, agentsOnly: opt["agents-only"] };
const viewOptions = (roots: string[], compact: boolean) => ({ compact, roots, home: homedir(), now: Date.now() });

switch (command) {
  case "list": {
    const roots = ghqRoots();
    const repos = app.snapshot(app.loadRepositories(roots, arg), filter);
    if (opt.json) console.log(JSON.stringify(repos, null, 2));
    else for (const row of treeRows(repos, viewOptions(roots, false))) console.log(formatRow(row, process.stdout.columns ?? 160, color));
    break;
  }

  case "watch": {
    const roots = ghqRoots();
    let repos = app.loadRepositories(roots, arg);
    let loadedAt = Date.now();
    const reload = () => {
      repos = app.loadRepositories(roots, arg);
      loadedAt = Date.now();
    };
    runWatch({
      // リポジトリ構成は 15 秒ごと、プロセスと状態は毎回取り直す
      rows: () => {
        if (Date.now() - loadedAt > 15_000) reload();
        return treeRows(app.snapshot(repos, filter), viewOptions(roots, true));
      },
      jump: (target) => {
        const r = app.jump(target, { create: true });
        return { ok: r.kind === "focused" || r.kind === "created", message: jumpMessage(r) };
      },
      reload,
      intervalMs: Number(opt.interval) * 1000,
      exitOnJump: opt.popup,
      color,
    });
    break;
  }

  case "status":
    console.log(formatCells(statusLine(app.loadSessions()), opt.tmux ? "tmux" : color));
    break;

  case "jump": {
    const target: JumpTarget = /^\d+$/.test(arg ?? "")
      ? { title: `pid ${arg}`, name: `pid ${arg}`, pid: Number(arg) }
      : { title: arg ?? ".", name: arg ?? ".", path: realPath(arg ?? process.cwd()) };
    const r = app.jump(target, { create: opt.create, dryRun: opt["dry-run"] });
    console.log(formatCells([jumpMessage(r)], color));
    process.exitCode = r.kind === "notFound" || r.kind === "failed" ? 1 : 0;
    break;
  }

  case "hook": {
    // 失敗しても Claude Code の動作は止めない
    try {
      const input = await Bun.stdin.text();
      const notice = app.handleHook(JSON.parse(input || "{}") as HookEvent);
      const notifyOn = (process.env.AGENT_WS_NOTIFY ?? "waiting,ready,error").split(",");
      if (notice && notifyOn.includes(notice.session.status)) {
        const { title, body } = notification(notice);
        notify(title, body);
      }
    } catch { /* 無視 */ }
    break;
  }

  case "hooks-config":
    console.log(JSON.stringify(app.hooksConfig(realPath(process.argv[1])), null, 2));
    break;
}
