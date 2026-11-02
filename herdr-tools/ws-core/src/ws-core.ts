import { basename } from "@herdr-tools/utils/basename";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { claudeResumeCommand, sessionIdFromSessionStartHook } from "./claude-code";
import { resumable, type AgentNode } from "./domain/agent";
import { makeLocator } from "./domain/locate";
import { buildTree, mainRepositoryOf, pathsToInspect, type PathInspection } from "./domain/tree";
import type { AgentRuntime, WorkspaceSource } from "./ports";

interface WsCoreOptions {
  home?: string;
  claudeBin?: string;
  resumeWaitMs?: number;
  stopWaitMs?: number;
}

export class WsCore {
  private readonly claudeBin: string;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly source: WorkspaceSource,
    private readonly opts: WsCoreOptions = {},
  ) {
    this.claudeBin = opts.claudeBin ?? "claude";
  }

  async snapshot(opts: { allEntries?: boolean; alwaysShow?: string[] } = {}) {
    const ghqRoot = await this.source.root();
    const [agents, entries] = await Promise.all([this.runtime.list(), opts.allEntries ? this.source.entries(ghqRoot) : []]);
    const requested = [...(opts.alwaysShow ?? []), ...entries];
    const requestedInspections = await this.source.inspect(pathsToInspect(agents, requested));
    const siblings = await this.siblingWorktreesOf(requestedInspections);
    const inspected = new Set(requestedInspections.map((i) => i.path));
    const inspections = [...requestedInspections, ...(await this.source.inspect(siblings.filter((p) => !inspected.has(p))))];
    const alwaysShow = [...requested, ...siblings];
    const tree = buildTree({ agents, inspections, alwaysShow, ghqRoot, home: this.opts.home });
    return { tree, locate: makeLocator(tree, inspections) };
  }

  private async siblingWorktreesOf(inspections: PathInspection[]) {
    const repos = [...new Set(inspections.flatMap((i) => (i.commonDir ? [mainRepositoryOf(i.commonDir)] : [])))];
    return (await mapLimit(repos, 16, (repo) => this.source.worktrees(repo))).flat();
  }

  attachCommand(id: string) {
    return this.runtime.attachCommand(id);
  }

  subscribe(onChange: () => void) {
    return this.runtime.subscribe(onChange);
  }

  async resume(id: string) {
    const a = await this.runtime.get(id);
    if (!a) return { resumed: false, reason: "not-found" } as const;
    if (!resumable(a)) {
      if (!a.alive) return { resumed: false, reason: "finished" } as const;
      if (!a.claudeSessionId) return { resumed: false, reason: "no-session-id" } as const;
      return { resumed: false, reason: "running" } as const;
    }
    await this.runtime.type(a.id, claudeResumeCommand(this.claudeBin, a.claudeSessionId!));
    await this.waitUntilProgramIsBack(a.id);
    return { resumed: true, claudeSessionId: a.claudeSessionId! } as const;
  }

  private async waitUntilProgramIsBack(id: string) {
    const deadline = Date.now() + (this.opts.resumeWaitMs ?? 3000);
    while (Date.now() < deadline) {
      await Bun.sleep(150);
      if ((await this.runtime.get(id))?.programLost !== true) return;
    }
  }

  async startAgent(path: string, claudeArgs: string[] = []) {
    const [inspection] = await this.source.inspect([path]);
    if (!inspection?.exists) throw new Error(`ディレクトリがありません: ${path}`);
    const worktree = inspection.toplevel ?? path;
    const workspace = inspection.commonDir ? mainRepositoryOf(inspection.commonDir) : worktree;
    return this.runtime.start({ workspace, worktree, repo: basename(workspace), branch: inspection.branch ?? null, command: [this.claudeBin, ...claudeArgs] });
  }

  async recordClaudeSessionFromHook(stdin: string, env: Record<string, string | undefined>) {
    const id = this.runtime.agentIdOfCurrentProcess(env);
    if (!id) return { recorded: false, reason: "not-in-runtime" } as const;
    const sessionId = sessionIdFromSessionStartHook(stdin);
    if (!sessionId) return { recorded: false, reason: "no-session-id" } as const;
    await this.runtime.recordClaudeSession(id, sessionId);
    return { recorded: true } as const;
  }

  async stopAgent(id: string) {
    const agent = (await this.runtime.list()).find((a) => a.id === id);
    if (!agent) return { stopped: false, reason: "not-found" } as const;
    await this.stopAndRemove(agent);
    return { stopped: true } as const;
  }

  async removeAgents(agents: AgentNode[]) {
    for (const a of agents) await this.stopAndRemove(a).catch(() => {});
  }

  private async stopAndRemove(agent: { id: string; alive: boolean }) {
    if (agent.alive) {
      await this.runtime.stop(agent.id);
      await this.waitUntilFinished(agent.id);
    }
    await this.runtime.remove(agent.id);
  }

  private async waitUntilFinished(id: string) {
    const deadline = Date.now() + (this.opts.stopWaitMs ?? 3000);
    while (Date.now() < deadline) {
      if ((await this.runtime.get(id))?.alive !== true) return;
      await Bun.sleep(100);
    }
  }
}
