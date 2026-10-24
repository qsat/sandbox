/** リポジトリ・worktree・プロセス */

import type { Session } from "./session.ts";

export type Pid = number;

export type AgentKind = "claude" | "codex" | "aider" | "gemini" | "cursor" | "copilot" | "opencode" | "amp";

export interface Repository {
  name: string; // ghq root からの相対（github.com/owner/repo）
  path: string; // メイン worktree
  worktrees: Worktree[];
}

export interface Worktree {
  path: string;
  branch: string | null; // detached なら null
  head: string;
  isMain: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: number | null; // 変更ファイル数（表示対象だけ数える）
  processes: Proc[];
}

/** OS から見えるプロセス */
export interface ProcInfo {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
  cwd: string | null; // 読めなければ null
}

/** worktree に属するプロセス。エージェントなら agent / session が付く */
export interface Proc extends ProcInfo {
  cwd: string;
  agent: AgentKind | null;
  session: Session | null;
}

export interface Filter {
  all: boolean; // 何も動いていないリポジトリも出す
  agentsOnly: boolean; // エージェントのプロセスだけ（いない worktree は省く）
}
