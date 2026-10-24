/**
 * コマンドの外から来るもの: 環境変数・いまの時刻・端末。プロセスの境界（cli.ts）で1回だけ作る
 * これより内側（コマンド・middleware・購読者）は process.env も Date.now() も見ない（clock の middleware を除く）
 */
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Ghq } from "../redux/middlewares/git/git.ts";
import type { NoticeKind } from "../redux/types/attention.ts";
import type { ColorMode, Display } from "../ui/terminal.ts";

type Env = Record<string, string | undefined>;

export interface Context {
  now: number; // コマンドが起動した時刻
  stateDir: string; // ログの置き場所: AGENT_WS_STATE_DIR、なければ $XDG_STATE_HOME/agent-ws/agents
  ghq: Ghq; // GHQ_ROOT とホーム
  notify: NoticeKind[]; // 知らせる種類: AGENT_WS_NOTIFY（既定 waiting,asking,ready,error。空なら知らせない）
  inTmux: boolean; // TMUX
  dump?: string; // hook の入力をそのまま追記するファイル: AGENT_WS_DUMP（入力の形を確かめるとき用）
}

export function contextOf(env: Env, now: number, home = homedir()): Context {
  return {
    now,
    stateDir: env.AGENT_WS_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "agent-ws", "agents"),
    ghq: { root: (env.GHQ_ROOT ?? "").split(delimiter).filter(Boolean), home },
    notify: (env.AGENT_WS_NOTIFY ?? "waiting,asking,ready,error").split(",").filter(Boolean) as NoticeKind[],
    inTmux: Boolean(env.TMUX),
    dump: env.AGENT_WS_DUMP,
  };
}

/** 端末に色を付けるか（端末か FORCE_COLOR=1 のとき） */
function colorOf(out: { isTTY?: boolean }, env: Env): ColorMode {
  if (out.isTTY || env.FORCE_COLOR === "1") return "ansi";
  return "none";
}

export const displayOf = (out: { isTTY?: boolean; columns?: number }, env: Env, home = homedir()): Display => ({
  color: colorOf(out, env),
  width: out.columns ?? 160,
  home,
});
