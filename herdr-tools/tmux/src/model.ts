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
export function sessionNameFor(path: string) {
  return basename(path).replace(/[.:]/g, "_");
}

/** ws-core に「これも見たい」と渡すパス（セッションの場所） */
export function interestingPaths(facts: TmuxFacts) {
  return facts.sessions.map((s) => s.path).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 索引: worktree → セッション、エージェント → ペイン
// ---------------------------------------------------------------------------

export function indexTmux(locate: Locate, facts: TmuxFacts) {
  const sessionsByWt = Map.groupBy(facts.sessions, (s) => locate(s.path)?.worktree.path);
  const panesByAgent = Map.groupBy(
    facts.panes.filter((p) => p.agent && !p.dead),
    (p) => p.agent,
  );
  const panesOf = (agentId: string) => panesByAgent.get(agentId) ?? [];
  return {
    facts,
    /** worktree のセッション（tm 規則の名前のものを優先） */
    sessionOf: (worktreePath: string) => {
      const arr = sessionsByWt.get(worktreePath) ?? [];
      return arr.find((s) => s.name === sessionNameFor(worktreePath)) ?? arr[0];
    },
    panesOf,
    isAttached: (agentId: string) => panesOf(agentId).length > 0,
  };
}

export type TmuxIndex = ReturnType<typeof indexTmux>;

// ---------------------------------------------------------------------------
// 移動に使うクライアント
// ---------------------------------------------------------------------------

export function pickRecentClient(clients: TmuxClient[]) {
  return [...clients].sort((a, b) => b.activity - a.activity)[0];
}

/**
 * 移動に使う tmux クライアント:
 *   client … 既存クライアントを switch-client
 *   attach … tmux の外のシェルから: その場で tmux attach
 *   ghostty-new … app から、クライアントが1つも無い: Ghostty の新しいウィンドウで attach
 */
export function chooseClient(opts: { explicit?: string; fromApp: boolean; insideTmuxClient?: string; clients: TmuxClient[] }) {
  const client = (name: string) => ({ kind: "client" as const, name });
  if (opts.explicit) return client(opts.explicit);
  if (opts.fromApp) {
    const c = pickRecentClient(opts.clients);
    return c ? client(c.name) : { kind: "ghostty-new" as const };
  }
  if (opts.insideTmuxClient) return client(opts.insideTmuxClient);
  return { kind: "attach" as const };
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

interface GoContext {
  client: ReturnType<typeof chooseClient>;
  fromApp: boolean;
  /** 場所が消えた worktree のときにセッションを作るディレクトリ */
  fallbackCwd: string;
}

/** worktree で作業するディレクトリ（場所が消えていれば fallback） */
export function workingDir(wt: WorktreeNode, fallback: string) {
  return wt.exists ? wt.path : fallback;
}

export function planGo(target: Resolved, idx: TmuxIndex, ctx: GoContext) {
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

interface PanesOptions {
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
export function planPruneSessions(tree: Tree, idx: TmuxIndex) {
  return tree.workspaces
    .flatMap((ws) => ws.worktrees)
    .flatMap((wt) => {
      const s = wt.exists ? undefined : idx.sessionOf(wt.path);
      return s ? [s.name] : [];
    });
}
