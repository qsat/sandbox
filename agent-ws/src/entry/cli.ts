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
 *   entry/*（初期化）─┬→ redux/createStore・redux/modules/{slug}/{slice,selector,listener}
 *                    │        └→ domain/model（純粋）・claude/hook（Claude Code の入力の境界）・infra/*（I/O）
 *                    └→ ui/*（表示）
 */
import { parseArgs } from "node:util";
import { hooksConfig } from "../claude/hook.ts";
import { realPath } from "../infra/shell.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { runHook } from "./hook.ts";
import { runJump } from "./jump.ts";
import { runList } from "./list.ts";
import { runSeen } from "./seen.ts";
import { runStatus } from "./status.ts";
import { runWatch } from "./watch.ts";

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

switch (command) {
  case "list":
    runList({ query: arg, filter, json: opt.json, color });
    break;
  case "watch":
    runWatch({ query: arg, filter, intervalMs: Number(opt.interval) * 1000, popup: opt.popup, color });
    break;
  case "status":
    runStatus({ color: opt.tmux ? "tmux" : color });
    break;
  case "seen":
    if (/^\d+$/.test(arg ?? "")) runSeen(Number(arg));
    break;
  case "jump":
    process.exitCode = runJump({ arg, create: opt.create, dryRun: opt["dry-run"], color }) ? 0 : 1;
    break;
  case "hook":
    await runHook();
    break;
  case "hooks-config":
    console.log(JSON.stringify(hooksConfig(process.execPath, realPath(process.argv[1])), null, 2));
    break;
}
