// ユースケース層: 事実を infra から集め、domain で判断し、その計画を infra で実行する。
// ws は自前の状態ファイルを持たない（事実は herdr-core と tmux が持つ）。

import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import {
  AGENTS_WINDOW,
  LABEL_WS,
  LABEL_WT,
  basename,
  buildTree,
  chooseClient,
  collectCandidatePaths,
  isShell,
  looksLikePath,
  needsResume,
  planGo,
  planPanes,
  planPrune,
  resolveRef,
  sessionIdOf,
  terminalNameFor,
  workspacePathFromCommonDir,
  type Resolved,
  type Step,
  type Terminal,
  type TmuxPane,
  type TmuxSession,
  type Tree,
} from "./domain";
import * as hc from "./infra/hc";
import * as tmux from "./infra/tmux";
import * as git from "./infra/git";
import { shellQuote } from "./infra/exec";

/** ラベルのキー。実機確認でキーに . が使えなければ WS_SESSION_LABEL=claude_session */
export const SESSION_LABEL = process.env.WS_SESSION_LABEL || "claude.session";
/** エージェントとして起動するコマンド */
const CLAUDE_BIN = process.env.WS_CLAUDE_BIN || "claude";

export interface Snapshot {
  tree: Tree;
  terminals: Terminal[];
  sessions: TmuxSession[];
  panes: TmuxPane[];
}

export async function snapshot(opts: { all?: boolean; include?: string[] } = {}): Promise<Snapshot> {
  const root = await git.ghqRoot();
  const [terminals, sessions, panes, ghqEntries] = await Promise.all([hc.listTerminals(), tmux.listSessions(), tmux.listPanes(), git.ghqList(root)]);
  const candidates = collectCandidatePaths({ terminals, sessions, ghqEntries, all: !!opts.all, extra: opts.include });
  const infos = await git.pathInfos(candidates);
  // include は toplevel に解決したうえで強制表示する
  const include = (opts.include ?? []).map((p) => infos.find((i) => i.path === p)?.toplevel ?? p);
  const tree = buildTree({ terminals, sessions, panes, infos, ghqEntries, ghqRoot: root, home: homedir(), all: !!opts.all, include });
  return { tree, terminals, sessions, panes };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function list(opts: { all?: boolean }): Promise<Tree> {
  return (await snapshot(opts)).tree;
}

// ---------------------------------------------------------------------------
// go
// ---------------------------------------------------------------------------

export interface GoOptions {
  client?: string;
  fromApp?: boolean;
  /** 実行せず計画だけ返す */
  dryRun?: boolean;
}

export function normalizeRef(ref: string, cwd = process.cwd()): string {
  if (!looksLikePath(ref)) return ref;
  return resolvePath(cwd, git.expandHome(ref));
}

export async function go(rawRef: string, opts: GoOptions = {}): Promise<Step[]> {
  const ref = normalizeRef(rawRef);
  const snap = await snapshot({ include: looksLikePath(ref) ? [ref] : [] });
  const target = resolveRef(snap.tree, ref);
  if (!target) throw new Error(`見つかりません: ${rawRef}`);
  return goTo(target, snap, opts);
}

async function goTo(target: Resolved, snap: Snapshot, opts: GoOptions): Promise<Step[]> {
  const clients = await tmux.listClients();
  const client = chooseClient({
    explicit: opts.client,
    fromApp: !!opts.fromApp,
    insideTmuxClient: opts.fromApp ? undefined : await tmux.currentClient(),
    clients,
  });
  const steps = planGo(target, { sessions: snap.sessions, panes: snap.panes, client, fromApp: !!opts.fromApp, fallbackCwd: homedir() });
  if (!opts.dryRun) await execute(steps);
  return steps;
}

function sessionTarget(t: string): string {
  // %12 はペイン。セッション名は前方一致で別セッションに当たらないよう = を付ける
  return t.startsWith("%") || t.startsWith("=") ? t : `=${t}`;
}

export async function execute(steps: Step[]): Promise<void> {
  for (const s of steps) {
    switch (s.op) {
      case "newSession":
        await tmux.newSession(s.name, s.cwd);
        break;
      case "resume":
        await resume(s.address);
        break;
      case "selectPane":
        await tmux.selectPane(s.paneId);
        break;
      case "openAttachPane":
        await tmux.openAttachPane(s.session, s.window, s.cwd, s.address, hc.attachCommand(s.address));
        break;
      case "switchClient":
        await tmux.switchClient(s.client, sessionTarget(s.target));
        break;
      case "attach":
        await tmux.attach(sessionTarget(s.target));
        break;
      case "ghosttyNewWindow":
        await git.ghosttyNewWindow(tmux.attachArgv(sessionTarget(s.target)));
        break;
      case "focusGhostty":
        await git.focusGhostty();
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

export type ResumeResult = { resumed: true; sessionId: string } | { resumed: false; reason: string };

/**
 * 要再開なら claude --resume <id> を送る。何度呼んでも安全（対象外なら何もしない）。
 * 送ったあとは前面が claude に変わるまで少し待つ（続けて attach したときに素のシェルを見せないため）。
 */
export async function resume(ref: string, opts: { waitMs?: number } = {}): Promise<ResumeResult> {
  const t = await hc.getTerminal(ref);
  if (!t) return { resumed: false, reason: "not-found" };
  if (!needsResume(t)) {
    if (t.state !== "live") return { resumed: false, reason: "finished" };
    if (!sessionIdOf(t.labels)) return { resumed: false, reason: "no-session-id" };
    return { resumed: false, reason: "running" };
  }
  const id = sessionIdOf(t.labels)!;
  await hc.sendText(t.address, `${CLAUDE_BIN} --resume ${shellQuote(id)}`);
  const deadline = Date.now() + (opts.waitMs ?? 3000);
  while (Date.now() < deadline) {
    await Bun.sleep(150);
    const now = await hc.getTerminal(t.address);
    if (!now?.foreground || !isShell(now.foreground.name)) break;
  }
  return { resumed: true, sessionId: id };
}

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

export interface NewOptions {
  attach?: boolean;
  client?: string;
  fromApp?: boolean;
  claudeArgs?: string[];
}

export async function newAgent(worktreeArg: string | undefined, opts: NewOptions = {}): Promise<{ address: string; name: string; steps?: Step[] }> {
  const path = resolvePath(process.cwd(), git.expandHome(worktreeArg ?? "."));
  const info = await git.pathInfo(path);
  if (!info.exists) throw new Error(`ディレクトリがありません: ${path}`);
  const wt = info.toplevel ?? path;
  const wsPath = info.commonDir ? workspacePathFromCommonDir(info.commonDir) : wt;

  const terminals = await hc.listTerminals();
  const taken = terminals.filter((t) => t.state === "live").map((t) => t.name);
  const name = terminalNameFor(basename(wsPath), info.branch, taken);

  const out = await hc.runTerminal({
    name,
    cwd: wt,
    labels: { [LABEL_WS]: wsPath, [LABEL_WT]: wt },
    command: [CLAUDE_BIN, ...(opts.claudeArgs ?? [])],
  });
  // hc run の出力形式に依存しないよう、名前で引き直してアドレスを得る（名前は生きている端末の中で一意）
  const again = await hc.listTerminals();
  const address = again.find((t) => t.name === name && t.state === "live")?.address ?? /^\s*(t\d+)\s*$/m.exec(out)?.[1];
  if (!address) throw new Error(`起動した端末が見つかりません: ${name}`);

  if (!opts.attach) return { address, name };
  const steps = await go(address, { client: opts.client, fromApp: opts.fromApp });
  return { address, name, steps };
}

// ---------------------------------------------------------------------------
// panes
// ---------------------------------------------------------------------------

export interface PanesResult {
  session: string;
  opened: string[];
  skipped: string[];
  alreadyAttached: number;
}

export async function panes(opts: { pane?: string; all?: boolean; max?: number }): Promise<PanesResult> {
  const paneId = opts.pane ?? process.env.TMUX_PANE;
  if (!paneId) throw new Error("--pane '#{pane_id}' を渡してください（tmux の外からは使えません）");
  const info = await tmux.paneInfo(paneId);
  if (!info) throw new Error(`ペインがありません: ${paneId}`);

  const snap = await snapshot({ include: [info.currentPath] });
  const wt =
    snap.tree.workspaces.flatMap((w) => w.worktrees).find((w) => w.session?.name === info.session) ??
    (resolveRef(snap.tree, info.currentPath) as Resolved | undefined)?.worktree;
  if (!wt) throw new Error("このペインの worktree が分かりません");

  const plan = planPanes(wt, { includeChildren: !!opts.all, max: opts.max ?? Number(process.env.WS_PANES_MAX || 8) });
  for (const a of plan.resume) await resume(a.address);
  const opened: string[] = [];
  for (const a of plan.open) {
    await tmux.openAttachPane(info.session, AGENTS_WINDOW, wt.exists ? wt.path : homedir(), a.address, hc.attachCommand(a.address));
    opened.push(a.address);
  }
  return {
    session: info.session,
    opened,
    skipped: plan.skipped.map((a) => a.address),
    alreadyAttached: wt.agents.filter((a) => a.attached).length,
  };
}

// ---------------------------------------------------------------------------
// hook session-start
// ---------------------------------------------------------------------------

/**
 * Claude Code の SessionStart hook。stdin の JSON から session_id を取り、
 * core の端末内（$HC_TERMINAL_ID がある）ならラベルに記録する。
 * hook の標準出力は Claude のコンテキストに入るので何も出さない。失敗しても Claude を止めない。
 */
export async function hookSessionStart(stdin: string, env = process.env): Promise<{ labeled: boolean; reason?: string }> {
  const terminal = env.HC_TERMINAL_ID;
  if (!terminal) return { labeled: false, reason: "not-in-herdr-core" };
  let sessionId: string | undefined;
  try {
    sessionId = JSON.parse(stdin)?.session_id;
  } catch {
    return { labeled: false, reason: "bad-json" };
  }
  if (!sessionId) return { labeled: false, reason: "no-session-id" };
  await hc.setLabel(terminal, SESSION_LABEL, sessionId);
  return { labeled: true };
}

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

export interface PrunePlan {
  sessions: string[];
  agents: { address: string; name: string; state: string }[];
}

export async function prunePlan(): Promise<PrunePlan> {
  const snap = await snapshot();
  const p = planPrune(snap.tree);
  return { sessions: p.sessions, agents: p.agents.map((a) => ({ address: a.address, name: a.name, state: a.state })) };
}

export async function pruneApply(plan: PrunePlan, opts: { agents: boolean }): Promise<void> {
  for (const s of plan.sessions) await tmux.killSession(s).catch(() => {});
  if (!opts.agents) return;
  for (const a of plan.agents) {
    if (a.state === "live") await hc.killTerminal(a.address).catch(() => {});
    await hc.removeTerminal(a.address).catch(() => {});
  }
}
