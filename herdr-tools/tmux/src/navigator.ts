import { homedir } from "node:os";
import { looksLikePath, resolveRef, type Resolved, type WsCore } from "@herdr-tools/ws-core";
import { focusGhostty, openGhosttyWindowRunning } from "./ghostty";
import { AGENTS_WINDOW, chooseClient, planGo, workingDir, type Step } from "./plans/go";
import { planPanes } from "./plans/panes";
import { indexTmux, sessionPaths } from "./tmux-index";
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

  async go(target: Resolved, view: TmuxView, opts: GoOptions = {}) {
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
    const target = resolveRef(view.snap, ref);
    if (!target) throw new Error(`見つかりません: ${ref}`);
    return this.go(target, view, opts);
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

    const plan = planPanes(wt, view.idx, opts);
    for (const a of plan.open) {
      await this.tmux.openAgentPane(pane.session, AGENTS_WINDOW, workingDir(wt, this.cwdWhenMissing), a.id, this.core.attachCommand(a.id));
    }
    return { opened: plan.open.length, overLimit: plan.overLimit.length, alreadyOpen: wt.agents.filter((a) => view.idx.isAttached(a.id)).length };
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

  private worktreeOfSession(view: TmuxView, session: string) {
    return view.snap.tree.workspaces.flatMap((ws) => ws.worktrees).find((wt) => view.idx.sessionOf(wt.path)?.name === session);
  }
}

type TmuxView = Awaited<ReturnType<TmuxNavigator["view"]>>;
