import { homedir } from "node:os";
import { runInteractive } from "@herdr-tools/utils/run-interactive";
import { looksLikePath, resolveRef, type Resolved, type WsCore } from "@herdr-tools/ws-core";
import { focusGhostty, openGhosttyWindowRunning } from "./ghostty";
import { AGENTS_WINDOW, chooseClient, planGo, workingDir, type PaneTarget, type Step } from "./plans/go";
import { cycleCandidates, decideCurrentPane, MESSAGE_WHEN_NO_CANDIDATE, nextCandidate, prevCandidate } from "./plans/cycle";
import { planPanes } from "./plans/panes";
import { indexTmux, isPaneId, sessionPaths } from "./tmux-index";
import { TmuxServer } from "./tmux-server";

interface GoOptions {
  client?: string;
  fromApp?: boolean;
  dryRun?: boolean;
}

export class TmuxNavigator {
  private readonly cwdWhenMissing = homedir();

  constructor(
    readonly core: WsCore,
    readonly tmux = new TmuxServer(),
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async view(opts: { allEntries?: boolean; alsoShow?: string[] } = {}) {
    const facts = await this.tmux.facts();
    const snap = await this.core.snapshot({ allEntries: opts.allEntries, alwaysShow: [...sessionPaths(facts), ...(opts.alsoShow ?? [])] });
    return { snap, idx: indexTmux(snap.locate, facts) };
  }

  async go(target: Resolved | PaneTarget, view: TmuxView, opts: GoOptions = {}) {
    const client = chooseClient({
      explicit: opts.client,
      fromApp: !!opts.fromApp,
      callerClient: opts.fromApp ? undefined : await this.tmux.callerClient(this.env),
      clients: await this.tmux.listClients(),
    });
    const steps = planGo(target, view.idx, { client, fromApp: !!opts.fromApp, cwdWhenMissing: this.cwdWhenMissing });
    if (!opts.dryRun) for (const step of steps) await this.run(step);
    return steps;
  }

  async goRef(ref: string, opts: GoOptions = {}) {
    const view = await this.view({ alsoShow: looksLikePath(ref) ? [ref] : [] });
    const target = isPaneId(ref) ? this.paneTarget(view, ref) : resolveRef(view.snap, ref);
    if (!target) throw new Error(`見つかりません: ${ref}`);
    return this.go(target, view, opts);
  }

  async startAgentAndTalkHere(path: string, claudeArgs: string[]) {
    const agent = await this.core.startAgent(path, claudeArgs);
    const pane = this.env.TMUX ? this.env.TMUX_PANE : undefined;
    if (pane) await this.tmux.markPaneAsConversation(pane, agent.id);
    try {
      await runInteractive("sh", ["-c", this.core.attachCommand(agent.id)]);
    } finally {
      if (pane) await this.tmux.unmarkPane(pane).catch(() => {});
    }
    return agent;
  }

  async startAgentAndGo(path: string, claudeArgs: string[], opts: GoOptions = {}) {
    const agent = await this.core.startAgent(path, claudeArgs);
    return { ...agent, steps: await this.goRef(agent.id, opts) };
  }

  private async run(step: Step) {
    switch (step.op) {
      case "newSession":
        return this.tmux.newSession(step.name, step.cwd);
      case "selectPane":
        return this.tmux.selectPane(step.paneId);
      case "openAgentPane":
        return this.tmux.openAgentPane(step.session, step.window, step.cwd, step.agentId, this.core.attachCommand(step.agentId));
      case "switchClient":
        return this.tmux.switchClient(step.client, step.target);
      case "attachHere":
        return this.tmux.attachHere(step.target);
      case "newGhosttyWindow":
        return openGhosttyWindowRunning(this.tmux.attachArgv(step.target));
      case "focusGhostty":
        return focusGhostty();
    }
  }

  async openPanesForWorktreeOf(paneId: string, opts: { includeChildren: boolean; max: number }) {
    const pane = await this.tmux.paneInfo(paneId);
    if (!pane) throw new Error(`ペインがありません: ${paneId}`);
    const view = await this.view({ alsoShow: [pane.currentPath] });
    const wt = this.worktreeOfSession(view, pane.session) ?? view.snap.locate(pane.currentPath)?.worktree;
    if (!wt) throw new Error("このペインの worktree が分かりません");

    const plan = planPanes(wt, view.idx, { ...opts, session: pane.session });
    for (const g of plan.gather) await this.tmux.moveAgentPane(g.paneId, pane.session, AGENTS_WINDOW);
    for (const a of plan.open) {
      await this.tmux.openAgentPane(pane.session, AGENTS_WINDOW, workingDir(wt, this.cwdWhenMissing), a.id, this.core.attachCommand(a.id));
    }
    return { opened: plan.open.length, gathered: plan.gather.length, overLimit: plan.overLimit.length, alreadyOpen: plan.inPlace.length };
  }

  async cycleAgents(opts: { prev?: boolean; pane?: string; client?: string; fromApp?: boolean; listOnly?: boolean } = {}) {
    const view = await this.view();
    const candidates = cycleCandidates(view.snap.tree);
    if (opts.listOnly) return { candidates, moved: undefined, message: undefined };
    const clients = await this.tmux.listClients();
    const client = chooseClient({ explicit: opts.client, fromApp: !!opts.fromApp, callerClient: undefined, clients });
    const clientName = client.kind === "switch" ? client.name : undefined;
    const currentPane = decideCurrentPane({
      explicit: opts.pane,
      envPane: this.env.TMUX_PANE,
      clientPane: clientName ? await this.tmux.paneShownBy(clientName) : undefined,
      displayedPanes: view.idx.facts.panes.filter((p) => p.current).map((p) => p.paneId),
    });
    const target = (opts.prev ? prevCandidate : nextCandidate)(candidates, currentPane ? view.idx.livePaneById(currentPane)?.agentId : undefined);
    if (!target) {
      const message = MESSAGE_WHEN_NO_CANDIDATE;
      await this.tmux.displayMessage(message, opts.fromApp ? clientName : opts.client).catch(() => {});
      return { candidates, moved: undefined, message };
    }
    await this.goRef(target.agent.id, { client: opts.client, fromApp: opts.fromApp });
    return { candidates, moved: target, message: undefined };
  }

  async closeSessionOf(ref: string) {
    const view = await this.view({ alsoShow: looksLikePath(ref) ? [ref] : [] });
    const target = resolveRef(view.snap, ref);
    if (!target) throw new Error(`見つかりません: ${ref}`);
    const session = view.idx.sessionOf(target.worktree.path);
    if (!session) return { closed: false, reason: "no-session" } as const;
    await this.tmux.killSession(session.name);
    return { closed: true, session: session.name } as const;
  }

  async killSessions(names: string[]) {
    for (const n of names) await this.tmux.killSession(n).catch(() => {});
  }

  private paneTarget(view: TmuxView, paneId: string): PaneTarget | undefined {
    return view.idx.livePaneById(paneId) && { kind: "pane", paneId };
  }

  private worktreeOfSession(view: TmuxView, session: string) {
    return view.snap.tree.workspaces.flatMap((ws) => ws.worktrees).find((wt) => view.idx.sessionOf(wt.path)?.name === session);
  }
}

type TmuxView = Awaited<ReturnType<TmuxNavigator["view"]>>;
