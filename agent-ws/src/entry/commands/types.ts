/**
 * コマンドへの入力: 何をするか（Command）と、コマンドの外から来るもの（Context）
 * プロセスの境界（cli.ts・command.ts・context.ts）がこれを作り、コマンドはこれだけを受け取る
 */
import type { Ghq } from "../../redux/middlewares/git/git.ts";
import type { Pid } from "../../redux/types/agent.ts";
import type { NoticeKind } from "../../redux/types/attention.ts";
import type { VisitTarget } from "../../redux/types/visit.ts";
import type { Filter } from "../../redux/types/workspace.ts";

export type Command =
  | { kind: "list"; query?: string; filter: Filter; json: boolean }
  | { kind: "watch"; query?: string; filter: Filter; intervalMs: number; popup: boolean }
  | { kind: "status"; tmux: boolean }
  | { kind: "seen"; panePid: Pid }
  | { kind: "jump"; target: VisitTarget; create: boolean; dryRun: boolean }
  | { kind: "hook" }
  | { kind: "hooksConfig" }
  | { kind: "usage"; message: string }; // 引数が解釈できない

/** その種類の Command */
export type Of<K extends Command["kind"]> = Extract<Command, { kind: K }>;

/** 環境変数・いまの時刻・このプロセスについて */
export interface Context {
  now: number; // コマンドが起動した時刻
  stateDir: string; // ログの置き場所: AGENT_WS_STATE_DIR、なければ $XDG_STATE_HOME/agent-ws/agents
  ghq: Ghq; // GHQ_ROOT とホーム
  notify: NoticeKind[]; // 知らせる種類: AGENT_WS_NOTIFY（既定 waiting,asking,ready,error。空なら知らせない）
  inTmux: boolean; // TMUX
  dump?: string; // hook の入力をそのまま追記するファイル: AGENT_WS_DUMP（入力の形を確かめるとき用）
  pid: Pid; // このプロセス（自分をエージェントの一覧から除く）
  ppid: Pid; // 親のプロセス（hook なら、その祖先に claude 本体がいる）
  platform: string; // 通知の出し方を決める（darwin なら osascript）
}
