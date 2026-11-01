// ドメインモデルと純粋なルール。I/O は一切持たない（bun test で単体テストする）。
//
// 木の形: Workspace（本体リポジトリ）> Worktree（ghq の1エントリ）> Agent（herdr-core の端末）
// tmux の Session / Pane は Worktree と Agent にぶら下がる「付帯情報」。

// ---------------------------------------------------------------------------
// 事実（infra が外部から読んで、この形に正規化して渡す）
// ---------------------------------------------------------------------------

export type AgentStatus = "working" | "blocked" | "idle" | "done" | "error" | "unknown";

/** herdr-core の端末（terminal.list / terminal.get / hc ls --json を正規化したもの） */
export interface Terminal {
  address: string; // t7 など。この core で不変
  name: string;
  cwd: string;
  labels: Record<string, string>;
  parent: string | null;
  state: "live" | "finished";
  status: AgentStatus;
  kind?: string; // blocked のとき permission / question / auth
  msg?: string;
  /** 今の前面プロセス。terminal.list に含まれないこともある（そのとき undefined） */
  foreground?: { name: string; argv?: string[]; cwd?: string; pid?: number } | null;
  argv?: string[];
  exitCode?: number | null;
}

/** パス1つについて infra が調べた結果（git rev-parse と存在確認） */
export interface PathInfo {
  path: string; // 問い合わせたパス（ラベルや session_path の生の値）
  exists: boolean;
  /** git 管理下なら worktree のトップ（realpath 済み） */
  toplevel?: string;
  /** git の common dir（絶対パス）。本体リポジトリの特定に使う */
  commonDir?: string;
  branch?: string | null;
}

export interface TmuxSession {
  name: string;
  path: string;
  attached: boolean;
}

export interface TmuxPane {
  session: string;
  windowIndex: number;
  windowName: string;
  paneId: string; // %12
  hc: string | null; // ペインオプション @hc
  dead: boolean;
  currentPath?: string;
}

export interface TmuxClient {
  name: string;
  session: string;
  activity: number;
}

// ---------------------------------------------------------------------------
// ラベルと命名規則
// ---------------------------------------------------------------------------

export const LABEL_WS = "ws";
export const LABEL_WT = "wt";
/** 実機確認でキーに . が使えなければ WS_SESSION_LABEL=claude_session にする */
export const SESSION_LABEL_CANDIDATES = ["claude.session", "claude_session"] as const;

export function sessionIdOf(labels: Record<string, string>): string | undefined {
  for (const k of SESSION_LABEL_CANDIDATES) {
    const v = labels[k];
    if (v) return v;
  }
  return undefined;
}

/** tm 規則: パスの basename、. は _ に置換（tmux はセッション名の . と : を嫌う） */
export function sessionNameFor(path: string): string {
  return basename(path).replace(/[.:]/g, "_");
}

const NAME_MAX = 32;

/**
 * core の端末名規則: 英小文字・数字・-・_ の1〜32文字、生きている端末の中で一意。
 * <repo>-<branch> を slug 化し、重複時は -2, -3 … を付ける。
 */
export function terminalNameFor(repo: string, branch: string | null | undefined, taken: Iterable<string>): string {
  const raw = branch && branch !== repo ? `${repo}-${branch}` : repo;
  let base = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!base) base = "agent";
  base = base.slice(0, NAME_MAX).replace(/[-_]+$/g, "") || "agent";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const cand = base.slice(0, NAME_MAX - suffix.length).replace(/[-_]+$/g, "") + suffix;
    if (!used.has(cand)) return cand;
  }
}

// ---------------------------------------------------------------------------
// パス
// ---------------------------------------------------------------------------

export function basename(p: string): string {
  const t = p.replace(/\/+$/g, "");
  const i = t.lastIndexOf("/");
  return i < 0 ? t : t.slice(i + 1);
}

export function dirname(p: string): string {
  const t = p.replace(/\/+$/g, "");
  const i = t.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return t.slice(0, i);
}

/**
 * child が base そのものか base/ 配下か。
 * 単純な前方一致だと ~/ghq/x/repo と ~/ghq/x/repo=branch が混ざるので、境界で判定する。
 */
export function isUnderPath(child: string, base: string): boolean {
  const b = base.replace(/\/+$/g, "");
  return child === b || child.startsWith(b + "/");
}

/** candidates のうち p を含む最も深いもの */
export function findContainingPath(p: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const c of candidates) {
    if (isUnderPath(p, c) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

/** git common dir から本体リポジトリのパスを出す（.git の親。bare ならそのもの） */
export function workspacePathFromCommonDir(commonDir: string): string {
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

export function displayName(path: string, ghqRoot: string | undefined, home: string | undefined): string {
  if (ghqRoot && isUnderPath(path, ghqRoot) && path !== ghqRoot.replace(/\/+$/g, "")) {
    return path.slice(ghqRoot.replace(/\/+$/g, "").length + 1);
  }
  if (home && isUnderPath(path, home)) return "~" + path.slice(home.replace(/\/+$/g, "").length);
  return path;
}

// ---------------------------------------------------------------------------
// 状態の導出
// ---------------------------------------------------------------------------

const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);

export function isShell(name: string | undefined | null): boolean {
  if (!name) return false;
  return SHELLS.has(basename(name.replace(/^-/, "")));
}

/**
 * 要再開: core の端末は生きているが、--keep によって claude がシェルに置き換わっており、
 * かつ hook が記録したセッションIDがある。
 */
export function needsResume(t: Terminal): boolean {
  return t.state === "live" && !!t.foreground && isShell(t.foreground.name) && !!sessionIdOf(t.labels);
}

/** 人の注意が要る順。小さいほど先 */
export function attentionRank(a: { status: AgentStatus; needsResume: boolean }): number {
  if (a.status === "blocked") return 0;
  if (a.needsResume) return 1;
  if (a.status === "error") return 2;
  if (a.status === "idle") return 3;
  if (a.status === "working") return 4;
  if (a.status === "done") return 5;
  return 6;
}

// ---------------------------------------------------------------------------
// 木（ws list の出力）
// ---------------------------------------------------------------------------

export interface AgentNode {
  address: string;
  name: string;
  status: AgentStatus;
  kind?: string;
  msg?: string;
  state: "live" | "finished";
  parent: string | null;
  cwd: string;
  sessionId?: string;
  needsResume: boolean;
  /** どのペインの @hc にも対応しない */
  attached: boolean;
  /** ラベル wt のディレクトリが存在しない（直接削除された worktree） */
  missingLocation: boolean;
  panes: string[];
}

export interface WorktreeNode {
  path: string;
  branch: string | null;
  exists: boolean;
  isMain: boolean;
  session: { name: string; attached: boolean } | null;
  agents: AgentNode[];
}

export interface WorkspaceNode {
  path: string;
  name: string;
  worktrees: WorktreeNode[];
}

export interface Tree {
  workspaces: WorkspaceNode[];
}

export interface CandidateInput {
  terminals: Terminal[];
  sessions: TmuxSession[];
  ghqEntries: string[];
  all: boolean;
  extra?: string[];
}

/** agent の居場所の手がかり（ラベル wt を優先、無ければ cwd） */
export function agentAnchor(t: Terminal): string {
  return t.labels[LABEL_WT] || t.cwd;
}

/** git で調べる必要のあるパス */
export function collectCandidatePaths(input: CandidateInput): string[] {
  const s = new Set<string>();
  for (const x of input.sessions) if (x.path) s.add(x.path);
  for (const t of input.terminals) {
    const a = agentAnchor(t);
    if (a) s.add(a);
  }
  if (input.all) for (const e of input.ghqEntries) s.add(e);
  for (const e of input.extra ?? []) s.add(e);
  return [...s];
}

export interface BuildInput {
  terminals: Terminal[];
  sessions: TmuxSession[];
  panes: TmuxPane[];
  infos: PathInfo[];
  ghqEntries: string[];
  ghqRoot?: string;
  home?: string;
  all: boolean;
  /** フィルタに関係なく必ず含めるパス（ws go <path> 用） */
  include?: string[];
}

interface WtAcc {
  path: string;
  branch: string | null;
  exists: boolean;
  workspace: string;
  sessions: TmuxSession[];
  terms: Terminal[];
  forced: boolean;
}

export function buildTree(input: BuildInput): Tree {
  const infoByPath = new Map(input.infos.map((i) => [i.path, i]));
  const wts = new Map<string, WtAcc>();

  // 問い合わせたパス → worktree のキー
  const keyOf = (p: string): { key: string; info?: PathInfo } => {
    const info = infoByPath.get(p);
    if (info?.exists && info.toplevel) return { key: info.toplevel, info };
    return { key: p.replace(/\/+$/g, "") || p, info };
  };

  const ensure = (p: string, fallbackWorkspace?: string): WtAcc => {
    const { key, info } = keyOf(p);
    let acc = wts.get(key);
    if (!acc) {
      const exists = info ? info.exists : true;
      acc = {
        path: key,
        branch: info?.branch ?? null,
        exists,
        workspace: info?.commonDir ? workspacePathFromCommonDir(info.commonDir) : fallbackWorkspace || key,
        sessions: [],
        terms: [],
        forced: false,
      };
      wts.set(key, acc);
    }
    return acc;
  };

  for (const t of input.terminals) {
    const anchor = agentAnchor(t);
    const info = infoByPath.get(anchor);
    // 解決できなかった cwd は、既知の worktree のどれかに境界判定で含める
    if (!info && !t.labels[LABEL_WT]) {
      const known = findContainingPath(anchor, [...wts.keys(), ...input.ghqEntries]);
      if (known) {
        ensure(known, t.labels[LABEL_WS]).terms.push(t);
        continue;
      }
    }
    ensure(anchor, t.labels[LABEL_WS]).terms.push(t);
  }

  for (const s of input.sessions) {
    if (!s.path) continue;
    ensure(s.path).sessions.push(s);
  }

  if (input.all) for (const e of input.ghqEntries) if (infoByPath.get(e)?.exists !== false) ensure(e);
  for (const e of input.include ?? []) ensure(e).forced = true;

  const panesByHc = new Map<string, TmuxPane[]>();
  for (const p of input.panes) {
    if (!p.hc || p.dead) continue;
    const arr = panesByHc.get(p.hc) ?? [];
    arr.push(p);
    panesByHc.set(p.hc, arr);
  }

  const workspaces = new Map<string, WorkspaceNode>();
  for (const acc of wts.values()) {
    if (!input.all && !acc.forced && acc.sessions.length === 0 && acc.terms.length === 0) continue;
    let ws = workspaces.get(acc.workspace);
    if (!ws) {
      ws = { path: acc.workspace, name: displayName(acc.workspace, input.ghqRoot, input.home), worktrees: [] };
      workspaces.set(acc.workspace, ws);
    }
    const expected = sessionNameFor(acc.path);
    const sess = acc.sessions.find((s) => s.name === expected) ?? acc.sessions[0];
    ws.worktrees.push({
      path: acc.path,
      branch: acc.branch,
      exists: acc.exists,
      isMain: acc.path === acc.workspace,
      session: sess ? { name: sess.name, attached: sess.attached } : null,
      agents: acc.terms.map((t) => toAgentNode(t, panesByHc.get(t.address) ?? [], acc.exists)).sort(byName),
    });
  }

  const out = [...workspaces.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const ws of out) {
    ws.worktrees.sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path));
  }
  return { workspaces: out };
}

function byName(a: AgentNode, b: AgentNode): number {
  return a.name.localeCompare(b.name) || a.address.localeCompare(b.address);
}

function toAgentNode(t: Terminal, panes: TmuxPane[], wtExists: boolean): AgentNode {
  return {
    address: t.address,
    name: t.name,
    status: t.status,
    kind: t.kind,
    msg: t.msg,
    state: t.state,
    parent: t.parent,
    cwd: t.cwd,
    sessionId: sessionIdOf(t.labels),
    needsResume: needsResume(t),
    attached: panes.length > 0,
    missingLocation: !!t.labels[LABEL_WT] && !wtExists,
    panes: panes.map((p) => p.paneId),
  };
}

// ---------------------------------------------------------------------------
// 参照の解決（ws go <ref>）
// ---------------------------------------------------------------------------

export type Resolved =
  | { kind: "worktree"; worktree: WorktreeNode; workspace: WorkspaceNode }
  | { kind: "agent"; agent: AgentNode; worktree: WorktreeNode; workspace: WorkspaceNode };

export function looksLikePath(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("~") || ref.startsWith(".");
}

/** ref はエージェントのアドレス（または端末名）か、worktree のパス（絶対パス化済み） */
export function resolveRef(tree: Tree, ref: string): Resolved | undefined {
  const pathRef = looksLikePath(ref);
  if (!pathRef) {
    for (const workspace of tree.workspaces)
      for (const worktree of workspace.worktrees)
        for (const agent of worktree.agents) if (agent.address === ref) return { kind: "agent", agent, worktree, workspace };
    for (const workspace of tree.workspaces)
      for (const worktree of workspace.worktrees)
        for (const agent of worktree.agents) if (agent.name === ref) return { kind: "agent", agent, worktree, workspace };
  }
  let best: Resolved | undefined;
  for (const workspace of tree.workspaces)
    for (const worktree of workspace.worktrees)
      if (isUnderPath(ref, worktree.path) && (!best || worktree.path.length > best.worktree.path.length))
        best = { kind: "worktree", worktree, workspace };
  return best;
}

export function findAgent(tree: Tree, address: string): { agent: AgentNode; worktree: WorktreeNode; workspace: WorkspaceNode } | undefined {
  const r = resolveRef(tree, address);
  return r?.kind === "agent" ? r : undefined;
}

// ---------------------------------------------------------------------------
// ws go の移動計画（どの操作をどの順で行うか）
// ---------------------------------------------------------------------------

export const AGENTS_WINDOW = "agents";

/** 移動に使う tmux クライアント */
export type ClientChoice =
  | { kind: "client"; name: string } // 既存クライアントを switch-client
  | { kind: "attach" } // tmux の外のシェルから: その場で tmux attach
  | { kind: "ghostty-new" }; // app から、クライアントが1つも無い: Ghostty の新しいウィンドウで attach

export type Step =
  | { op: "newSession"; name: string; cwd: string }
  | { op: "resume"; address: string }
  | { op: "selectPane"; paneId: string }
  | { op: "openAttachPane"; session: string; window: string; cwd: string; address: string }
  | { op: "switchClient"; client: string; target: string }
  | { op: "attach"; target: string }
  | { op: "ghosttyNewWindow"; target: string }
  | { op: "focusGhostty" };

export interface GoContext {
  sessions: TmuxSession[];
  panes: TmuxPane[];
  client: ClientChoice;
  fromApp: boolean;
  /** 場所が消えた worktree のときにセッションを作るディレクトリ */
  fallbackCwd: string;
}

/**
 * 直近に使われたクライアント。mod から動かすときはこれを使う。
 */
export function pickRecentClient(clients: TmuxClient[]): TmuxClient | undefined {
  return [...clients].sort((a, b) => b.activity - a.activity)[0];
}

export function chooseClient(opts: {
  explicit?: string;
  fromApp: boolean;
  insideTmuxClient?: string;
  clients: TmuxClient[];
}): ClientChoice {
  if (opts.explicit) return { kind: "client", name: opts.explicit };
  if (opts.fromApp) {
    const c = pickRecentClient(opts.clients);
    return c ? { kind: "client", name: c.name } : { kind: "ghostty-new" };
  }
  if (opts.insideTmuxClient) return { kind: "client", name: opts.insideTmuxClient };
  return { kind: "attach" };
}

export function planGo(target: Resolved, ctx: GoContext): Step[] {
  const steps: Step[] = [];
  const wt = target.worktree;
  const cwd = wt.exists ? wt.path : ctx.fallbackCwd;

  // 1) セッションを用意（無ければ tm 規則で作る）
  let session = wt.session?.name;
  if (!session) {
    const name = sessionNameFor(wt.path);
    // 同名のセッションが既にあれば（別 owner の同名リポジトリ）それを使う。tm と同じ挙動
    if (!ctx.sessions.some((s) => s.name === name)) steps.push({ op: "newSession", name, cwd });
    session = name;
  }

  let switchTarget = session;
  if (target.kind === "agent") {
    const a = target.agent;
    // 2) 要再開なら再開（C）。ws resume と同じ処理で、対象外なら何もしない
    if (a.needsResume) steps.push({ op: "resume", address: a.address });
    // 3) attach 済みならそのペイン、まだならペインを作る
    const existing = ctx.panes.find((p) => p.hc === a.address && !p.dead);
    if (existing) {
      steps.push({ op: "selectPane", paneId: existing.paneId });
      switchTarget = existing.paneId;
    } else {
      steps.push({ op: "openAttachPane", session, window: AGENTS_WINDOW, cwd, address: a.address });
      switchTarget = `${session}:${AGENTS_WINDOW}`;
    }
  }

  // 4) tmux クライアントを切り替える
  switch (ctx.client.kind) {
    case "client":
      steps.push({ op: "switchClient", client: ctx.client.name, target: switchTarget });
      if (ctx.fromApp) steps.push({ op: "focusGhostty" });
      break;
    case "attach":
      steps.push({ op: "attach", target: switchTarget });
      break;
    case "ghostty-new":
      steps.push({ op: "ghosttyNewWindow", target: switchTarget });
      break;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// ws panes の計画
// ---------------------------------------------------------------------------

export interface PanesOptions {
  includeChildren: boolean;
  max: number;
}

/** worktree のエージェントのうち、まだどこにも attach されていないものを開く */
export function planPanes(wt: WorktreeNode, opts: PanesOptions): { open: AgentNode[]; resume: AgentNode[]; skipped: AgentNode[] } {
  const candidates = wt.agents
    .filter((a) => a.state === "live")
    .filter((a) => opts.includeChildren || !a.parent)
    .sort((a, b) => attentionRank(a) - attentionRank(b) || byName(a, b));
  const notAttached = candidates.filter((a) => !a.attached);
  const open = notAttached.slice(0, Math.max(0, opts.max));
  return {
    open,
    resume: open.filter((a) => a.needsResume),
    skipped: notAttached.slice(open.length),
  };
}

// ---------------------------------------------------------------------------
// ws prune の計画
// ---------------------------------------------------------------------------

export function planPrune(tree: Tree): { sessions: string[]; agents: AgentNode[] } {
  const sessions: string[] = [];
  const agents: AgentNode[] = [];
  for (const ws of tree.workspaces)
    for (const wt of ws.worktrees) {
      if (wt.exists) continue;
      if (wt.session) sessions.push(wt.session.name);
      agents.push(...wt.agents);
    }
  return { sessions, agents };
}
