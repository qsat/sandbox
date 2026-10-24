/** ワークスペース: リポジトリと worktree（どこで作業しているか） */

import type { Agent, AgentProcess } from "./agent.ts";

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
  agents: AgentAt[]; // この worktree にいるエージェント（selector で結びつける）
}

/** worktree にいるエージェント: プロセスと、hook で分かった状況（hook が届いていなければ null）と、完了を見ていないか */
export interface AgentAt {
  process: AgentProcess;
  agent: Agent | null;
  unseen: boolean;
}

export interface Filter {
  all: boolean; // エージェントがいないリポジトリも出す
  agentsOnly: boolean; // エージェントのいる worktree だけ
}
