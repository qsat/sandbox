/**
 * コマンドライン → Command（何をするか）。引数の解釈はここだけで行う
 */
import { parseArgs } from "node:util";
import { attempt } from "../lib/attempt.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import type { Command } from "./commands/types.ts";

export const USAGE = `agent-ws — ghq 管理下のリポジトリ > worktree > エージェント を、応答状況つきで表示する

  agent-ws [list] [query] [--all] [--agents-only] [--json]  一覧を1回表示
  agent-ws watch [query] [--all] [--interval=2] [--popup]   常駐表示。j/k で選択、Enter でそのペインへ移動
  agent-ws status [--tmux]                                  ステータスライン用の印（⏳ 許可待ち / ❓ 質問待ち / ✓ 完了して未確認 / ✗ エラー）
  agent-ws seen <pane_pid>                                  そのペインで完了したものを既読にする（tmux の pane-focus-in から呼ぶ）
  agent-ws jump <pid|path> [--create] [--dry-run]           その pid / パスがいる tmux ペインへ移動
  agent-ws hook                                             Claude Code の hook から呼ばれる（stdin に JSON）
  agent-ws hooks-config                                     ~/.claude/settings.json に足す hooks 設定を出力

環境変数: AGENT_WS_NOTIFY（通知する状態。既定 waiting,asking,ready,error。空で通知しない）/ AGENT_WS_STATE_DIR / GHQ_ROOT
          AGENT_WS_DUMP（hook の入力をそのまま追記するファイル。入力の形を確かめるとき用）`;

const OPTIONS = {
  all: { type: "boolean", default: false },
  "agents-only": { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  tmux: { type: "boolean", default: false },
  popup: { type: "boolean", default: false },
  create: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  interval: { type: "string", default: "2" },
} as const;

const usage = (message: string): Command => ({ kind: "usage", message: `${message}\n\n${USAGE}` });

/** 数字なら pid、そうでなければパス（省くといまの場所） */
function targetOf(arg: string | undefined, cwd: string): VisitTarget {
  if (arg && /^\d+$/.test(arg)) return { title: `pid ${arg}`, name: `pid ${arg}`, pid: Number(arg) };
  return { title: arg ?? ".", name: arg ?? ".", path: arg ?? cwd };
}

function seenOf(arg: string | undefined): Command {
  if (!arg || !/^\d+$/.test(arg)) return usage("seen には pane_pid（数字）を渡す");
  return { kind: "seen", panePid: Number(arg) };
}

/** argv: コマンド名より後の引数。cwd: jump の行き先を省いたときの場所 */
export function parseCommand(argv: string[], cwd: string): Command {
  const parsed = attempt(() => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }), null);
  if (!parsed) return usage("解釈できない引数がある");
  const { values: o, positionals } = parsed;
  const filter = { all: o.all, agentsOnly: o["agents-only"] };
  /** サブコマンド → Command（arg はサブコマンドの次の引数） */
  const SUBCOMMANDS: Record<string, (arg?: string) => Command> = {
    list: (query) => ({ kind: "list", query, filter, json: o.json }),
    watch: (query) => ({ kind: "watch", query, filter, intervalMs: Number(o.interval) * 1000, popup: o.popup }),
    status: () => ({ kind: "status", tmux: o.tmux }),
    seen: seenOf,
    jump: (arg) => ({ kind: "jump", target: targetOf(arg, cwd), create: o.create, dryRun: o["dry-run"] }),
    hook: () => ({ kind: "hook" }),
    "hooks-config": () => ({ kind: "hooksConfig" }),
  };
  const [first = "", second] = positionals;
  const subcommand = SUBCOMMANDS[first];
  // サブコマンドが無ければ list（最初の引数は絞り込み）
  if (!subcommand) return SUBCOMMANDS.list(first || undefined);
  return subcommand(second);
}
