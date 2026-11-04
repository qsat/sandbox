import type { AgentNode, AgentStatus, Tree } from "@herdr-tools/ws-core";

export type CycleStatus = Extract<AgentStatus, "blocked" | "working">;

export interface CycleCandidate {
  agent: AgentNode;
  workspace: string;
  worktree: string;
}

export function isCycleStatus(s: string): s is CycleStatus {
  return s === "blocked" || s === "working";
}

export function cycleCandidates(tree: Tree, status: CycleStatus): CycleCandidate[] {
  return tree.workspaces
    .flatMap((ws) => ws.worktrees.flatMap((wt) => wt.agents.map((agent) => ({ agent, workspace: ws.name, worktree: wt.path }))))
    .filter((c) => c.agent.alive && c.agent.status === status)
    .sort((a, b) => a.workspace.localeCompare(b.workspace) || a.worktree.localeCompare(b.worktree) || a.agent.id.localeCompare(b.agent.id));
}

export function nextCandidate(candidates: CycleCandidate[], currentAgentId: string | null | undefined) {
  const at = candidates.findIndex((c) => c.agent.id === currentAgentId);
  return candidates[(at + 1) % candidates.length];
}

export function messageWhenNoCandidate(status: CycleStatus) {
  return status === "blocked" ? "入力待ちのエージェントはありません" : "作業中のエージェントはありません";
}
