import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { run } from "@herdr-tools/utils/run";
import { runInteractive } from "@herdr-tools/utils/run-interactive";
import { looksLikePath, resolveRef, type Resolved, type WsCore } from "@herdr-tools/ws-core";
import { focusGhostty, openGhosttyWindowRunning } from "./ghostty";
import { AGENTS_WINDOW, chooseClient, ensureSession, planGo, workingDir, type PaneTarget, type Step } from "./plans/go";
import { chooseCycleTarget, continuingRecord, cycleCandidates, decideCurrentPane, MESSAGE_WHEN_NO_CANDIDATE } from "./plans/cycle";
import { planPanes } from "./plans/panes";
import { HUNK_WINDOW, planHunk, type HunkSource } from "./plans/hunk";
import { editSocketPath, editWindowName, planEdit, serverEditorBin, SHARED_EDIT_WINDOW } from "./plans/edit";
import { HunkCli } from "./hunk-cli";
import { toListJson } from "./list-json";
import { goRefOf, rowIdOfPane, sidebarItems, stepFrom, steppableItems } from "./sidebar-order";
import { readCollapsed, readCycleRecord, writeCycleRecord } from "./step-state";
import { indexTmux, isPaneId, sessionPaths } from "./tmux-index";
import { TmuxServer } from "./tmux-server";

export const MESSAGE_WHEN_NO_ROW = "移る行がありません";
/** hunk を起動した直後、セッションが daemon に現れるのを待つ試行の回数（300ms 間隔） */
const HUNK_START_ATTEMPTS = 30;
/** nvim のソケットを置くフォルダー（tmux のセッションごとに 1 つのソケット） */
const NVIM_SOCKET_DIR = `${homedir()}/.cache/herdr-tools/nvim`;
/** `edit` ウィンドウがあるのに nvim が応答しないとき（起動した直後）、応答するのを待つ試行の回数（150ms 間隔） */
const NVIM_START_ATTEMPTS = 10;
/** nvim が応答するかを確かめる（--remote-expr）ときの時間の上限。固まった nvim で待ち続けないため */
const NVIM_RESPOND_TIMEOUT_MS = 1000;
/**
 * nvim --remote の時間の上限。--remote はサーバーにつながらないと、その場で nvim を開いて待ち続ける
 * （応答を確かめた直後に nvim が終わったときなど）ので、止めて失敗として返す
 */
const NVIM_REMOTE_TIMEOUT_MS = 3000;

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
    private readonly hunk = new HunkCli(),
  ) {}

  /** worktree の差分を hunk で開く。hunk のセッションがあれば中身を入れ替え、無ければ tmux セッションの hunk ウィンドウで起動し、file があればそこへ移る */
  async openInHunk(path: string, opts: { source: HunkSource; file?: string; client?: string; fromApp?: boolean }) {
    const view = await this.view({ alsoShow: [path] });
    const target = resolveRef(view.snap, path);
    if (!target) throw new Error(`見つかりません: ${path}`);
    const cwd = workingDir(target.worktree, this.cwdWhenMissing);
    const client = await this.clientToMove(opts);
    const session = ensureSession(target.worktree, view.idx, cwd);
    const steps = planHunk({
      cwd,
      hunkBin: this.hunk.bin,
      source: opts.source,
      file: opts.file,
      session,
      windowExists: await this.tmux.hasWindow(session.name, HUNK_WINDOW),
      hunkSessionExists: await this.hunk.hasSession(cwd),
      ctx: { client, fromApp: !!opts.fromApp, cwdWhenMissing: this.cwdWhenMissing },
    });
    for (const step of steps) await this.run(step);
    return steps;
  }

  /** その nvim が応答するか（`--remote-expr 1` の答えで確かめる） */
  private async nvimResponds(bin: string, socket: string) {
    if (!existsSync(socket)) return false;
    const r = await run(bin, ["--server", socket, "--remote-expr", "1"], { timeoutMs: NVIM_RESPOND_TIMEOUT_MS });
    return r.code === 0 && r.stdout.trim() === "1";
  }

  /**
   * worktree のファイルを $EDITOR（tmux のグローバルな環境の EDITOR）で開く。
   * EDITOR が nvim なら、tmux セッションごとに 1 つの `edit` ウィンドウの nvim を使い回し（--listen / --remote）、そうでなければファイルごとのウィンドウで起動する。クライアントをそのウィンドウへ移す
   */
  async openInEditor(path: string, opts: { file: string; client?: string; fromApp?: boolean }) {
    const view = await this.view({ alsoShow: [path] });
    const target = resolveRef(view.snap, path);
    if (!target) throw new Error(`見つかりません: ${path}`);
    const cwd = workingDir(target.worktree, this.cwdWhenMissing);
    const client = await this.clientToMove(opts);
    const session = ensureSession(target.worktree, view.idx, cwd);
    const editor = await this.tmux.globalEnv("EDITOR");
    const bin = serverEditorBin(editor);
    const socket = editSocketPath(NVIM_SOCKET_DIR, session.name);
    const sharedWindowExists = await this.tmux.hasWindow(session.name, SHARED_EDIT_WINDOW);
    let serverResponds = bin ? await this.nvimResponds(bin, socket) : false;
    // 起動した直後の nvim はまだソケットを作っていない。別のウィンドウを増やさないよう、少し待つ
    for (let i = 0; bin && sharedWindowExists && !serverResponds && i < NVIM_START_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      serverResponds = await this.nvimResponds(bin, socket);
    }
    const steps = planEdit({
      cwd,
      file: opts.file,
      session,
      editor,
      socket,
      sharedWindowExists,
      serverResponds,
      fileWindowExists: await this.tmux.hasWindow(session.name, editWindowName(opts.file)),
      ctx: { client, fromApp: !!opts.fromApp, cwdWhenMissing: this.cwdWhenMissing },
    });
    for (const step of steps) await this.run(step);
    return steps;
  }

  async view(opts: { allEntries?: boolean; alsoShow?: string[] } = {}) {
    const facts = await this.tmux.facts();
    const snap = await this.core.snapshot({ allEntries: opts.allEntries, alwaysShow: [...sessionPaths(facts), ...(opts.alsoShow ?? [])] });
    return { snap, idx: indexTmux(snap.locate, facts) };
  }

  /** 移動に使う tmux クライアント（--client > --from-app なら最後に使われたもの > 呼び出し元 > その場で attach） */
  private async clientToMove(opts: { client?: string; fromApp?: boolean }) {
    const [callerClient, clients] = await Promise.all([opts.fromApp ? undefined : this.tmux.callerClient(this.env), this.tmux.listClients()]);
    return chooseClient({ explicit: opts.client, fromApp: !!opts.fromApp, callerClient, clients });
  }

  async go(target: Resolved | PaneTarget, view: TmuxView, opts: GoOptions = {}) {
    const client = await this.clientToMove(opts);
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
      case "openHunkWindow":
        return void (await this.tmux.openWindowRunning(step.session, HUNK_WINDOW, step.cwd, step.argv));
      case "respawnHunkWindow":
        return this.tmux.respawnWindowRunning(step.session, HUNK_WINDOW, step.cwd, step.argv);
      case "openEditWindow":
        mkdirSync(NVIM_SOCKET_DIR, { recursive: true });
        return void (await this.tmux.openWindowRunning(step.session, step.window, step.cwd, step.argv));
      case "remoteEdit":
        await run(step.bin, ["--server", step.socket, "--remote", step.file], { timeoutMs: NVIM_REMOTE_TIMEOUT_MS }).then((r) => {
          if (r.code !== 0) throw new Error(`${step.bin} --remote: ${r.stderr.trim() || r.stdout.trim()}`);
        });
        return;
      case "hunkReload":
        return this.hunk.reload(step.cwd, step.args);
      case "hunkNavigate":
        return this.hunk.navigate(step.cwd, step.file, step.wait ? HUNK_START_ATTEMPTS : 1);
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

  /**
   * 注意が要る順の列を巡回する。続けて押している間（前回から CYCLE_BURST_MS 未満）は前回の列の順と前回移った先から続け、
   * 間が空いたら今いる場所は数えずに回り直す（前へは先頭、後ろへは最後）
   */
  async cycleAgents(opts: { recordPath: string; prev?: boolean; client?: string; fromApp?: boolean; listOnly?: boolean; nowMs?: number }) {
    const view = await this.view();
    const candidates = cycleCandidates(view.snap.tree);
    if (opts.listOnly) return { candidates, moved: undefined, message: undefined };
    const record = continuingRecord(await readCycleRecord(opts.recordPath), opts.nowMs ?? Date.now());
    const { list, target } = chooseCycleTarget(candidates, record, !!opts.prev);
    if (!target) {
      const clients = await this.tmux.listClients();
      const client = chooseClient({ explicit: opts.client, fromApp: !!opts.fromApp, callerClient: undefined, clients });
      const message = MESSAGE_WHEN_NO_CANDIDATE;
      await this.tmux.displayMessage(message, opts.fromApp && client.kind === "switch" ? client.name : opts.client).catch(() => {});
      return { candidates, moved: undefined, message };
    }
    await this.goRef(target.agent.id, { client: opts.client, fromApp: opts.fromApp });
    await writeCycleRecord(opts.recordPath, { atMs: Date.now(), order: list.map((c) => c.agent.id), lastId: target.agent.id }).catch(() => {});
    return { candidates, moved: target, message: undefined };
  }

  /**
   * サイドバー（mod）に並ぶ行の順で、今いる行の次（prev なら前）の行が指すところへ移る。
   * 並びは sidebarItems（mod と共通）。mod で畳んだ workspace の行は飛ばす
   */
  async stepRows(opts: {
    /** 畳んだ workspace を読む共有状態のファイル（無ければ何も畳んでいないとみなす） */
    sharedStatePath: string;
    prev?: boolean;
    pane?: string;
    client?: string;
    fromApp?: boolean;
    listOnly?: boolean;
  }) {
    const view = await this.view();
    const rows = steppableItems(sidebarItems(toListJson(view.snap.tree, view.idx, view.snap.usage), [], await readCollapsed(opts.sharedStatePath)));
    const clients = await this.tmux.listClients();
    const client = chooseClient({ explicit: opts.client, fromApp: !!opts.fromApp, callerClient: undefined, clients });
    const clientName = client.kind === "switch" ? client.name : undefined;
    const currentPane = decideCurrentPane({
      explicit: opts.pane,
      envPane: this.env.TMUX_PANE,
      clientPane: clientName ? await this.tmux.paneShownBy(clientName) : undefined,
      displayedPanes: view.idx.facts.panes.filter((p) => p.current).map((p) => p.paneId),
    });
    const current = currentPane ? rowIdOfPane(currentPane, view.idx.livePaneById(currentPane)?.agentId) : undefined;
    if (opts.listOnly) return { rows, current, moved: undefined, message: undefined };
    const target = stepFrom(rows, current, !!opts.prev);
    if (!target) {
      await this.tmux.displayMessage(MESSAGE_WHEN_NO_ROW, opts.fromApp ? clientName : opts.client).catch(() => {});
      return { rows, current, moved: undefined, message: MESSAGE_WHEN_NO_ROW };
    }
    await this.goRef(goRefOf(target), { client: opts.client, fromApp: opts.fromApp });
    return { rows, current, moved: target, message: undefined };
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
