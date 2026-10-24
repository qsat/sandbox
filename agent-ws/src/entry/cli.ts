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
 *   entry/*（コマンドごとに middleware・購読者を選んで Store を作る）
 *     ├→ redux/middlewares/*（外部システムとのやりとり: eventLog・claude・processes・git・tmux・clock）
 *     ├→ redux/subscribers/*（状態を人に見せる: statusLine・notifier）
 *     │     └→ redux/modules/{app,ui}/*（ドメイン: slice・selector・listener。I/O を知らない）
 *     └→ ui/*（描画）
 */
import { parseArgs } from "node:util";
import { hooksConfig } from "../redux/middlewares/claude/hook.ts";
import { realPath } from "../redux/middlewares/shared/shell.ts";
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
const filter = { all: opt.all, agentsOnly: opt["agents-only"] };

function colorMode(): ColorMode {
  if (process.stdout.isTTY || process.env.FORCE_COLOR === "1") return "ansi";
  return "none";
}
const color = colorMode();

/** ステータスラインに埋め込むときは tmux の書式で色を付ける */
function statusColor(): ColorMode {
  if (opt.tmux) return "tmux";
  return color;
}

/** サブコマンド → 処理（arg はサブコマンドの次の引数） */
const COMMANDS: Record<string, (arg?: string) => unknown> = {
  list: (query) => runList({ query, filter, json: opt.json, color }),
  watch: (query) => runWatch({ query, filter, intervalMs: Number(opt.interval) * 1000, popup: opt.popup, color }),
  status: () => runStatus({ color: statusColor() }),
  seen: (panePid) => {
    if (/^\d+$/.test(panePid ?? "")) runSeen(Number(panePid));
  },
  jump: (arg) => {
    if (!runJump({ arg, create: opt.create, dryRun: opt["dry-run"], color })) process.exitCode = 1;
  },
  hook: () => runHook(),
  "hooks-config": () => console.log(JSON.stringify(hooksConfig(process.execPath, realPath(process.argv[1])), null, 2)),
};

/** サブコマンドが無ければ list（最初の引数は絞り込み） */
async function main([first = "", second]: string[]): Promise<void> {
  const command = COMMANDS[first];
  if (!command) return void COMMANDS.list(first || undefined);
  await command(second);
}

await main(positionals);
