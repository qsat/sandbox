// tmux クライアントのモデル。I/O なし。
// ws-core の木（Workspace > Worktree > Agent）に、tmux の事実（セッション・ペイン・クライアント）を索引で添える。
// 実行環境（herdr-core など）のことは知らない。会話に入るコマンドや再開は呼び出し側から渡される。

import { basename } from "@herdr-tools/utils/basename";
import { byAttention, type AgentNode, type Locate, type Resolved, type Tree, type WorktreeNode } from "@herdr-tools/ws-core";

export interface TmuxSession {
  name: string;
  path: string;
  attached: boolean;
}

export interface TmuxPane {
  paneId: string; // %12
  /** ペインオプション @ws_agent（このペインで会話しているエージェントの id） */
  agent: string | null;
  dead: boolean;
}

export interface TmuxClient {
  name: string;
  activity: number;
}

export interface TmuxFacts {
  sessions: TmuxSession[];
  panes: TmuxPane[];
}

/** 会話ペインの印にするペインオプション */
export const AGENT_PANE_OPTION = "@ws_agent";
/** 会話ペインを置くウィンドウ */
export const AGENTS_WINDOW = "agents";

/** tm 規則: パスの basename、. と : は _（tmux はセッション名の . と : を嫌う） */
export function sessionNameFor(path: string): string {
  return basename(path).replace(/[.:]/g, "_");
}

/** ws-core に「これも見たい」と渡すパス（セッションの場所） */
export function interestingPaths(facts: TmuxFacts): string[] {
  return facts.sessions.map((s) => s.path).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 索引: worktree → セッション、エージェント → ペイン
// ---------------------------------------------------------------------------

export interface TmuxIndex {
  facts: TmuxFacts;
  sessionOf(worktreePath: string): TmuxSession | undefined;
  panesOf(agentId: string): TmuxPane[];
  isAttached(agentId: string): boolean;
}

export function indexTmux(locate: Locate, facts: TmuxFacts): TmuxIndex {
  const sessionsByWt = new Map<string, TmuxSession[]>();
  for (const s of facts.sessions) {
    const hit = s.path ? locate(s.path) : undefined;
    if (!hit) continue;
    const arr = sessionsByWt.get(hit.worktree.path) ?? [];
    arr.push(s);
    sessionsByWt.set(hit.worktree.path, arr);
  }
  const panesByAgent = new Map<string, TmuxPane[]>();
  for (const p of facts.panes) {
    if (!p.agent || p.dead) continue;
    const arr = panesByAgent.get(p.agent) ?? [];
    arr.push(p);
    panesByAgent.set(p.agent, arr);
  }
  return {
    facts,
    sessionOf: (wt) => {
      const arr = sessionsByWt.get(wt) ?? [];
      return arr.find((s) => s.name === sessionNameFor(wt)) ?? arr[0];
    },
    panesOf: (id) => panesByAgent.get(id) ?? [],
    isAttached: (id) => (panesByAgent.get(id)?.length ?? 0) > 0,
  };
}

// ---------------------------------------------------------------------------
// 移動に使うクライアント
// ---------------------------------------------------------------------------

export type ClientChoice =
  | { kind: "client"; name: string } // 既存クライアントを switch-client
  | { kind: "attach" } // tmux の外のシェルから: その場で tmux attach
  | { kind: "ghostty-new" }; // app から、クライアントが1つも無い: Ghostty の新しいウィンドウで attach

export function pickRecentClient(clients: TmuxClient[]): TmuxClient | undefined {
  return [...clients].sort((a, b) => b.activity - a.activity)[0];
}

export function chooseClient(opts: { explicit?: string; fromApp: boolean; insideTmuxClient?: string; clients: TmuxClient[] }): ClientChoice {
  if (opts.explicit) return { kind: "client", name: opts.explicit };
  if (opts.fromApp) {
    const c = pickRecentClient(opts.clients);
    return c ? { kind: "client", name: c.name } : { kind: "ghostty-new" };
  }
  if (opts.insideTmuxClient) return { kind: "client", name: opts.insideTmuxClient };
  return { kind: "attach" };
}

// ---------------------------------------------------------------------------
// ws go の移動計画
// ---------------------------------------------------------------------------

export type Step =
  | { op: "newSession"; name: string; cwd: string }
  /** 会話に入る前の準備（要再開なら再開。何度やっても安全なので毎回行う）。中身は呼び出し側が持つ */
  | { op: "prepareAgent"; agent: string }
  | { op: "selectPane"; paneId: string }
  | { op: "openAgentPane"; session: string; window: string; cwd: string; agent: string }
  | { op: "switchClient"; client: string; target: string }
  | { op: "attach"; target: string }
  | { op: "ghosttyNewWindow"; target: string }
  | { op: "focusGhostty" };

export interface GoContext {
  client: ClientChoice;
  fromApp: boolean;
  /** 場所が消えた worktree のときにセッションを作るディレクトリ */
  fallbackCwd: string;
}

/** worktree で作業するディレクトリ（場所が消えていれば fallback） */
export function workingDir(wt: WorktreeNode, fallback: string): string {
  return wt.exists ? wt.path : fallback;
}

export function planGo(target: Resolved, idx: TmuxIndex, ctx: GoContext): Step[] {
  const steps: Step[] = [];
  const wt = target.worktree;
  const cwd = workingDir(wt, ctx.fallbackCwd);

  // 1) セッションを用意（無ければ tm 規則で作る。同名があればそれを使う: 別 owner の同名リポジトリ）
  let session = idx.sessionOf(wt.path)?.name;
  if (!session) {
    session = sessionNameFor(wt.path);
    if (!idx.facts.sessions.some((s) => s.name === session)) steps.push({ op: "newSession", name: session, cwd });
  }

  let switchTarget = session;
  if (target.kind === "agent") {
    const a = target.agent;
    // 2) 要再開なら再開（C）。判定は再開する側が最新の状態で行うので、木の needsResume には頼らない
    steps.push({ op: "prepareAgent", agent: a.id });
    // 3) 会話ペインがあればそれ、無ければ作る（同じエージェントを二重に開かない）
    const existing = idx.panesOf(a.id)[0];
    if (existing) {
      steps.push({ op: "selectPane", paneId: existing.paneId });
      switchTarget = existing.paneId;
    } else {
      steps.push({ op: "openAgentPane", session, window: AGENTS_WINDOW, cwd, agent: a.id });
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

/** worktree のエージェントのうち、まだどこにも開かれていないものを注意が要る順に開く */
export function planPanes(wt: WorktreeNode, idx: TmuxIndex, opts: PanesOptions): { open: AgentNode[]; skipped: AgentNode[] } {
  const candidates = wt.agents
    .filter((a) => a.alive && (opts.includeChildren || !a.parent) && !idx.isAttached(a.id))
    .sort(byAttention);
  const open = candidates.slice(0, Math.max(0, opts.max));
  return { open, skipped: candidates.slice(open.length) };
}

// ---------------------------------------------------------------------------
// 片付け
// ---------------------------------------------------------------------------

/** 場所が消えた worktree のセッション */
export function planPruneSessions(tree: Tree, idx: TmuxIndex): string[] {
  const out: string[] = [];
  for (const ws of tree.workspaces)
    for (const wt of ws.worktrees) {
      const s = !wt.exists ? idx.sessionOf(wt.path) : undefined;
      if (s) out.push(s.name);
    }
  return out;
}
