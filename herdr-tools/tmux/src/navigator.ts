// tmux クライアントのユースケース: ws-core の木と tmux の事実を合わせて、移動・ペイン表示・片付けを行う。
// 実行環境（herdr-core など）は WsCore の AgentRuntime ポートの向こうにいて、ここからは見えない。

import { homedir } from "node:os";
import { looksLikePath, type Resolved, type Snapshot, type WorktreeNode, type WsCore } from "@herdr-tools/ws-core";
import { focusGhostty, ghosttyNewWindow } from "./ghostty";
import { AGENTS_WINDOW, chooseClient, indexTmux, interestingPaths, planGo, planPanes, planPruneSessions, type Step, type TmuxIndex } from "./model";
import { Tmux } from "./tmux";

export interface TmuxView {
  snap: Snapshot;
  idx: TmuxIndex;
}

export interface GoOptions {
  client?: string;
  fromApp?: boolean;
  dryRun?: boolean;
}

export interface PanesResult {
  session: string;
  opened: string[];
  skipped: string[];
  alreadyAttached: number;
}

export class TmuxNavigator {
  constructor(
    readonly core: WsCore,
    readonly tmux: Tmux = new Tmux(),
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /** ws-core の木に tmux の事実を添える。セッションの場所はエージェントがいなくても木に出す */
  async view(opts: { all?: boolean; include?: string[] } = {}): Promise<TmuxView> {
    const facts = await this.tmux.facts();
    const snap = await this.core.snapshot({ all: opts.all, include: [...interestingPaths(facts), ...(opts.include ?? [])] });
    return { snap, idx: indexTmux(snap.tree, snap.locate, facts) };
  }

  /** ws go: どこから呼んでも、最後は1つの tmux クライアントを切り替える */
  async go(target: Resolved, view: TmuxView, opts: GoOptions = {}): Promise<Step[]> {
    const client = chooseClient({
      explicit: opts.client,
      fromApp: !!opts.fromApp,
      insideTmuxClient: opts.fromApp ? undefined : await this.tmux.currentClient(this.env),
      clients: await this.tmux.listClients(),
    });
    const steps = planGo(target, view.idx, { client, fromApp: !!opts.fromApp, fallbackCwd: homedir() });
    if (!opts.dryRun) await this.execute(steps);
    return steps;
  }

  /** ref（worktree のパスかエージェントの id／名前）へ移動する */
  async goRef(ref: string, opts: GoOptions = {}): Promise<Step[]> {
    const view = await this.view({ include: looksLikePath(ref) ? [ref] : [] });
    const t = this.core.resolve(view.snap, ref);
    if (!t) throw new Error(`見つかりません: ${ref}`);
    return this.go(t, view, opts);
  }

  /** worktree でエージェントを起動し、そのまま会話ペインへ */
  async newAndGo(path: string, claudeArgs: string[], opts: GoOptions = {}): Promise<{ id: string; name: string; steps: Step[] }> {
    const r = await this.core.newAgent(path, claudeArgs);
    return { ...r, steps: await this.goRef(r.id, opts) };
  }

  async execute(steps: Step[]): Promise<void> {
    for (const s of steps) {
      switch (s.op) {
        case "newSession":
          await this.tmux.newSession(s.name, s.cwd);
          break;
        case "prepareAgent":
          await this.core.resume(s.agent);
          break;
        case "selectPane":
          await this.tmux.selectPane(s.paneId);
          break;
        case "openAgentPane":
          await this.tmux.openAgentPane(s.session, s.window, s.cwd, s.agent, this.core.runtime.attachCommand(s.agent));
          break;
        case "switchClient":
          await this.tmux.switchClient(s.client, target(s.target));
          break;
        case "attach":
          await this.tmux.attach(target(s.target));
          break;
        case "ghosttyNewWindow":
          await ghosttyNewWindow(this.tmux.attachArgv(target(s.target)));
          break;
        case "focusGhostty":
          await focusGhostty();
          break;
      }
    }
  }

  /** ws panes: ペインの worktree のエージェントを agents ウィンドウに並べる */
  async panes(paneId: string, opts: { includeChildren: boolean; max: number }): Promise<PanesResult> {
    const info = await this.tmux.paneInfo(paneId);
    if (!info) throw new Error(`ペインがありません: ${paneId}`);
    const view = await this.view({ include: [info.currentPath] });
    const wt = this.worktreeOfSession(view, info.session) ?? view.snap.locate(info.currentPath)?.worktree;
    if (!wt) throw new Error("このペインの worktree が分かりません");

    const plan = planPanes(wt, view.idx, opts);
    const opened: string[] = [];
    for (const a of plan.open) {
      if (a.needsResume) await this.core.resume(a.id);
      await this.tmux.openAgentPane(info.session, AGENTS_WINDOW, wt.exists ? wt.path : homedir(), a.id, this.core.runtime.attachCommand(a.id));
      opened.push(a.id);
    }
    return { session: info.session, opened, skipped: plan.skipped.map((a) => a.id), alreadyAttached: wt.agents.filter((a) => view.idx.isAttached(a.id)).length };
  }

  /** 場所が消えた worktree のセッション */
  prunePlan(view: TmuxView): string[] {
    return planPruneSessions(view.snap.tree, view.idx);
  }

  async killSessions(names: string[]): Promise<void> {
    for (const n of names) await this.tmux.killSession(n).catch(() => {});
  }

  private worktreeOfSession(view: TmuxView, session: string): WorktreeNode | undefined {
    for (const ws of view.snap.tree.workspaces) for (const wt of ws.worktrees) if (view.idx.sessionOf(wt.path)?.name === session) return wt;
    return undefined;
  }
}

/** %12 はペイン。セッション名は前方一致で別セッションに当たらないよう = を付ける */
function target(t: string): string {
  return t.startsWith("%") || t.startsWith("=") ? t : `=${t}`;
}
