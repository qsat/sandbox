import type { AgentNode, AgentStatus, Tree } from "@herdr-tools/ws-core";

export type CycleStatus = Extract<AgentStatus, "blocked" | "working" | "idle">;

const MESSAGE_WHEN_NO_CANDIDATE: Record<CycleStatus, string> = {
  blocked: "入力待ちのエージェントはありません",
  working: "作業中のエージェントはありません",
  idle: "待機中のエージェントはありません",
};

const STATUSES_TO_VISIT: Record<CycleStatus, AgentStatus[]> = {
  blocked: ["blocked"],
  working: ["working"],
  idle: ["idle", "done"],
};

export interface CycleCandidate {
  agent: AgentNode;
  workspace: string;
  worktree: string;
}

export function isCycleStatus(s: string): s is CycleStatus {
  return Object.hasOwn(MESSAGE_WHEN_NO_CANDIDATE, s);
}

export function cycleCandidates(tree: Tree, status: CycleStatus): CycleCandidate[] {
  return tree.workspaces
    .flatMap((ws) => ws.worktrees.flatMap((wt) => wt.agents.map((agent) => ({ agent, workspace: ws.name, worktree: wt.path }))))
    .filter((c) => c.agent.alive && STATUSES_TO_VISIT[status].includes(c.agent.status))
    .sort((a, b) => a.workspace.localeCompare(b.workspace) || a.worktree.localeCompare(b.worktree) || a.agent.id.localeCompare(b.agent.id));
}

export function nextCandidate(candidates: CycleCandidate[], currentAgentId: string | null | undefined) {
  const at = candidates.findIndex((c) => c.agent.id === currentAgentId);
  return candidates[(at + 1) % candidates.length];
}

export function messageWhenNoCandidate(status: CycleStatus) {
  return MESSAGE_WHEN_NO_CANDIDATE[status];
}

/**
 * 巡回で「今いるペイン」を決める。
 * 優先順: 明示（--pane）> 環境変数（TMUX_PANE）> 移動に使うクライアントが表示しているペイン > 表示中のペインの最初の 1 つ
 */
export function decideCurrentPane(opts: { explicit?: string; envPane?: string; clientPane?: string; displayedPanes: string[] }) {
  return opts.explicit || opts.envPane || opts.clientPane || opts.displayedPanes[0] || undefined;
}
