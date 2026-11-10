/** エージェントが名乗る状態。上ほど先に注意が要る（一覧の並び順）。名乗っていない・知らない状態は unknown */
const ATTENTION_ORDER = ["blocked", "error", "idle", "working", "done", "unknown"] as const;

export type AgentStatus = (typeof ATTENTION_ORDER)[number];

/** 外から来た状態の文字（herdr-core の status.state、Herdr app の端末の status）をドメインの状態にする。知らない値は unknown */
export function toAgentStatus(state: string | null | undefined): AgentStatus {
  return (ATTENTION_ORDER as readonly string[]).includes(state ?? "") ? (state as AgentStatus) : "unknown";
}

export interface AgentRecord {
  id: string;
  name: string;
  cwd: string;
  status: AgentStatus;
  blockedReason?: string;
  statusMs?: number;
  message?: string;
  alive: boolean;
  parent: string | null;
  recordedWorkspace?: string;
  recordedWorktree?: string;
  claudeSessionId?: string;
  programLost?: boolean;
  contextUsedPercentage?: number;
}

export type AgentNode = Omit<AgentRecord, "recordedWorkspace" | "recordedWorktree" | "programLost"> & {
  resumable: boolean;
  missingLocation: boolean;
};

export function resumable(a: AgentRecord) {
  return a.alive && a.programLost === true && !!a.claudeSessionId;
}

export function toAgentNode(a: AgentRecord, worktreeExists: boolean): AgentNode {
  const { recordedWorkspace: _ws, recordedWorktree, programLost: _lost, ...rest } = a;
  return { ...rest, resumable: resumable(a), missingLocation: !!recordedWorktree && !worktreeExists };
}

export function agentLocation(a: AgentRecord) {
  return a.recordedWorktree || a.cwd;
}

export function attentionRank(a: { status: AgentStatus }) {
  return ATTENTION_ORDER.indexOf(a.status);
}

export function byName(a: { name: string; id: string }, b: { name: string; id: string }) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function byAttention(a: AgentNode, b: AgentNode) {
  return attentionRank(a) - attentionRank(b) || byName(a, b);
}
