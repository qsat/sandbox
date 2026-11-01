export type AgentStatus = "working" | "blocked" | "idle" | "done" | "error" | "unknown";

export interface AgentRecord {
  id: string;
  name: string;
  cwd: string;
  status: AgentStatus;
  blockedReason?: string;
  message?: string;
  alive: boolean;
  parent: string | null;
  recordedWorkspace?: string;
  recordedWorktree?: string;
  claudeSessionId?: string;
  programLost?: boolean;
}

export type AgentNode = Omit<AgentRecord, "recordedWorkspace" | "recordedWorktree" | "programLost"> & {
  needsResume: boolean;
  missingLocation: boolean;
};

export function needsResume(a: AgentRecord) {
  return a.alive && a.programLost === true && !!a.claudeSessionId;
}

export function toAgentNode(a: AgentRecord, worktreeExists: boolean): AgentNode {
  const { recordedWorkspace: _ws, recordedWorktree, programLost: _lost, ...rest } = a;
  return { ...rest, needsResume: needsResume(a), missingLocation: !!recordedWorktree && !worktreeExists };
}

export function agentLocation(a: AgentRecord) {
  return a.recordedWorktree || a.cwd;
}

const ATTENTION_ORDER: AgentStatus[] = ["blocked", "error", "idle", "working", "done", "unknown"];

export function attentionRank(a: { status: AgentStatus; needsResume: boolean }) {
  if (a.status === "blocked") return 0;
  if (a.needsResume) return 0.5;
  return ATTENTION_ORDER.indexOf(a.status);
}

export function byName(a: { name: string; id: string }, b: { name: string; id: string }) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function byAttention(a: AgentNode, b: AgentNode) {
  return attentionRank(a) - attentionRank(b) || byName(a, b);
}
