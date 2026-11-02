import type { AgentRecord } from "./domain/agent";
import type { PathInspection } from "./domain/tree";

export interface AgentStartSpec {
  workspace: string;
  worktree: string;
  repo: string;
  branch: string | null;
  command: string[];
}

export interface AgentRuntime {
  list(): Promise<AgentRecord[]>;
  get(id: string): Promise<AgentRecord | undefined>;
  start(spec: AgentStartSpec): Promise<{ id: string; name: string }>;
  recordClaudeSession(id: string, claudeSessionId: string): Promise<void>;
  type(id: string, text: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  agentIdOfCurrentProcess(env: Record<string, string | undefined>): string | undefined;
  attachCommand(id: string): string;
  subscribe(onChange: () => void): () => void;
}

export interface WorkspaceSource {
  root(): Promise<string>;
  entries(root: string): Promise<string[]>;
  inspect(paths: string[]): Promise<PathInspection[]>;
  worktrees(repo: string): Promise<string[]>;
}
