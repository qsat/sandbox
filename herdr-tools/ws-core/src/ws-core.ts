import { basename } from "@herdr-tools/utils/basename";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { claudeResumeCommand, contextUsedPercentageFromStatusLine, sessionIdFromSessionStartHook, usageFromStatusLine } from "./claude-code";
import { resumable, type AgentNode } from "./domain/agent";
import { makeLocator } from "./domain/locate";
import { buildTree, mainRepositoryOf, pathsToInspect, type PathInspection } from "./domain/tree";
import { openWindows, sameUsage } from "./domain/usage";
import type { AgentRuntime, UsageStore, WorkspaceSource } from "./ports";

interface WsCoreOptions {
  home?: string;
  claudeBin?: string;
  resumeWaitMs?: number;
  stopWaitMs?: number;
  usageStore?: UsageStore;
  nowEpochSec?: () => number;
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
    return { tree, locate: makeLocator(tree, inspections), usage: await this.claudeUsage() };
  }

  private now() {
    return this.opts.nowEpochSec?.() ?? Math.floor(Date.now() / 1000);
  }

  async claudeUsage() {
    const stored = await this.opts.usageStore?.read().catch(() => undefined);
    return openWindows(stored, this.now());
  }

  async recordContextUsageFromStatusLine(stdin: string, env: Record<string, string | undefined>) {
    const id = this.runtime.agentIdOfCurrentProcess(env);
    if (!id) return { recorded: false, reason: "not-in-runtime" } as const;
    const used = contextUsedPercentageFromStatusLine(stdin);
    if (used === undefined) return { recorded: false, reason: "no-context" } as const;
    if ((await this.runtime.get(id))?.contextUsedPercentage === used) return { recorded: false, reason: "unchanged" } as const;
    await this.runtime.recordContextUsage(id, used);
    return { recorded: true, used } as const;
  }

  async recordClaudeUsageFromStatusLine(stdin: string) {
    const observed = usageFromStatusLine(stdin);
    if (!observed) return { recorded: false, reason: "no-rate-limits", usage: await this.claudeUsage() } as const;
    const usage = openWindows(observed, this.now());
    const store = this.opts.usageStore;
    if (!store) return { recorded: false, reason: "no-store", usage } as const;
    try {
      if (sameUsage(await store.read(), observed)) return { recorded: false, reason: "unchanged", usage } as const;
      await store.write(observed);
      return { recorded: true, usage } as const;
    } catch {
      return { recorded: false, reason: "store-unavailable", usage } as const;
    }
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

  /** ref は id か名前（ws go と同じく id を先に引く）。エージェントでない端末は一覧に無いので触らない */
  async stopAgent(ref: string) {
    const agents = await this.runtime.list();
    const agent = agents.find((a) => a.id === ref) ?? agents.find((a) => a.name === ref);
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
