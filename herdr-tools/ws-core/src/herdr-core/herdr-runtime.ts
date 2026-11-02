import { basename } from "@herdr-tools/utils/basename";
import type { AgentRecord, AgentStatus } from "../domain/agent";
import type { AgentRuntime, AgentStartSpec } from "../ports";
import { HcClient } from "./hc-client";
import type { HcTerminal } from "./hc-terminal";

export const LABEL = { workspace: "ws", worktree: "wt", claudeSession: "claude.session" };

const STATUSES = new Set(["working", "blocked", "idle", "done", "error"]);
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);
const TERMINAL_NAME_MAX = 32;

export function isShell(processName: string) {
  return SHELLS.has(basename(processName.replace(/^-/, "")));
}

export function uniqueTerminalName(repo: string, branch: string | null | undefined, taken: Iterable<string>) {
  const slug =
    (branch && branch !== repo ? `${repo}-${branch}` : repo)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, TERMINAL_NAME_MAX)
      .replace(/[-_]+$/g, "") || "agent";
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const candidate = slug.slice(0, TERMINAL_NAME_MAX - `-${i}`.length).replace(/[-_]+$/g, "") + `-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function isAgentTerminal(t: HcTerminal, claudeSessionLabel: string) {
  const reportsStatus = t.reported === true || t.status !== null;
  const startedByWs = !!(t.labels[LABEL.workspace] || t.labels[LABEL.worktree]);
  const hasClaudeSession = !!t.labels[claudeSessionLabel];
  return reportsStatus || startedByWs || hasClaudeSession;
}

export function toAgentRecord(t: HcTerminal, claudeSessionLabel: string): AgentRecord {
  const state = t.status?.state;
  return {
    id: t.address,
    name: t.name ?? t.address,
    cwd: t.cwd,
    status: state && STATUSES.has(state) ? (state as AgentStatus) : "unknown",
    blockedReason: t.status?.kind ?? undefined,
    message: t.status?.msg || undefined,
    alive: t.state === "live",
    parent: t.parent,
    recordedWorkspace: t.labels[LABEL.workspace] || undefined,
    recordedWorktree: t.labels[LABEL.worktree] || undefined,
    claudeSessionId: t.labels[claudeSessionLabel] || undefined,
    programLost: t.foreground ? isShell(t.foreground.name) : undefined,
  };
}

export class HerdrRuntime implements AgentRuntime {
  private readonly hc: HcClient;
  private readonly claudeSessionLabel: string;

  constructor(opts: { hcBin?: string; claudeSessionLabel?: string } = {}) {
    this.hc = new HcClient(opts.hcBin);
    this.claudeSessionLabel = opts.claudeSessionLabel ?? LABEL.claudeSession;
  }

  async list() {
    return (await this.hc.listIncludingFinished())
      .filter((t) => isAgentTerminal(t, this.claudeSessionLabel))
      .map((t) => toAgentRecord(t, this.claudeSessionLabel));
  }

  async get(id: string) {
    const t = await this.hc.get(id);
    return t && toAgentRecord(t, this.claudeSessionLabel);
  }

  async start(spec: AgentStartSpec) {
    const liveNames = (await this.hc.listIncludingFinished()).flatMap((t) => (t.state === "live" && t.name ? [t.name] : []));
    const name = uniqueTerminalName(spec.repo, spec.branch, liveNames);
    const labels = { [LABEL.workspace]: spec.workspace, [LABEL.worktree]: spec.worktree };
    return { id: await this.hc.runKeptInBackground({ name, cwd: spec.worktree, labels, argv: spec.command }), name };
  }

  recordClaudeSession(id: string, claudeSessionId: string) {
    return this.hc.label(id, { [this.claudeSessionLabel]: claudeSessionId });
  }

  type(id: string, text: string) {
    return this.hc.send(id, text);
  }

  stop(id: string) {
    return this.hc.kill(id);
  }

  remove(id: string) {
    return this.hc.rm(id);
  }

  agentIdOfCurrentProcess(env: Record<string, string | undefined>) {
    return env.HC_TERMINAL_ID || undefined;
  }

  attachCommand(id: string) {
    return `${this.hc.bin} attach ${id}`;
  }

  subscribe(onChange: () => void) {
    return this.hc.subscribe(onChange);
  }
}
