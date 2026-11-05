import { agentDisplayName } from "@herdr-tools/utils/agent-display-name";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import { byAttention, type AgentStatus } from "@herdr-tools/ws-core/domain/agent";
import type { ListedAgent, ListedTree } from "./list-json";

/**
 * サイドバー（Herdr app の mod agent-board）に並ぶ行の順。
 * mod の表示（board.ts の boardRows）と CLI（ws step）が同じ並びを使うよう、並びの決め方はここだけに書く。
 * I/O は無い（tmux も herdr-core も呼ばない）。
 */

/** Herdr app が持つ端末の今の状態。エージェントの status は、これがあれば一覧（ws list --json）の値より優先する */
export interface LiveTerminal {
  address: string;
  status: { state: string; kind?: string | null } | null;
}

type Workspace = ListedTree["workspaces"][number];
type Worktree = Workspace["worktrees"][number];
export type ListedPane = Worktree["tmux"]["panes"][number];
export type LiveAgent = Omit<ListedAgent, "status"> & { status: AgentStatus; blockedReason?: string };
export type SidebarWorktree = Omit<Worktree, "agents"> & { agents: LiveAgent[] };

export type SidebarItem =
  | { kind: "workspace"; key: string; ws: Workspace; waiting: number; collapsed: boolean }
  | { kind: "worktree"; key: string; wt: SidebarWorktree }
  | { kind: "agent"; key: string; agent: LiveAgent; wt: SidebarWorktree }
  | { kind: "pane"; key: string; pane: ListedPane; wt: SidebarWorktree };

function withLiveStatus(a: ListedAgent, live: Map<string, LiveTerminal>): LiveAgent {
  const st = live.get(a.id)?.status;
  return st ? { ...a, status: st.state as AgentStatus, blockedReason: st.kind ?? undefined } : (a as LiveAgent);
}

/** workspace の見出し → worktree → その worktree のエージェント（注意が要る順）→ ペイン。畳んだ workspace は見出しだけ */
export function sidebarItems(list: ListedTree, live: LiveTerminal[], collapsed: string[]): SidebarItem[] {
  const liveBy = new Map(live.map((t) => [t.address, t]));
  const folded = new Set(collapsed);
  return list.workspaces.flatMap((ws): SidebarItem[] => {
    const worktrees: SidebarWorktree[] = ws.worktrees.map((wt) => ({ ...wt, agents: wt.agents.map((a) => withLiveStatus(a, liveBy)).sort(byAttention) }));
    const waiting = worktrees.flatMap((wt) => wt.agents).filter((a) => a.status === "blocked").length;
    const header: SidebarItem = { kind: "workspace", key: ws.path, ws, waiting, collapsed: folded.has(ws.path) };
    if (folded.has(ws.path)) return [header];
    return [
      header,
      ...worktrees.flatMap((wt): SidebarItem[] => [
        { kind: "worktree", key: wt.path, wt },
        ...wt.agents.map((agent): SidebarItem => ({ kind: "agent", key: agent.id, agent, wt })),
        ...wt.tmux.panes.map((pane): SidebarItem => ({ kind: "pane", key: pane.paneId, pane, wt })),
      ]),
    ];
  });
}

export function itemId(item: { kind: string; key: string }) {
  return `${item.kind}:${item.key}`;
}

/** 移る先に数える行（workspace の見出しは数えない） */
export function steppableItems(items: SidebarItem[]) {
  return items.filter((i) => i.kind === "agent" || i.kind === "pane");
}

/** ws go に渡す ref。worktree はパス、エージェントは id、ペインは %12 */
export function goRefOf(item: SidebarItem) {
  return item.key;
}

export function itemLabel(item: SidebarItem) {
  switch (item.kind) {
    case "workspace":
      return item.ws.name;
    case "worktree":
      return worktreeDisplayName(item.wt);
    case "agent":
      return agentDisplayName(item.agent);
    case "pane":
      return item.pane.command;
  }
}

/** 今いるペインから決まる行の id。会話ペインならエージェントの行、そうでなければペインの行 */
export function rowIdOfPane(paneId: string, agentId: string | undefined | null) {
  return agentId ? `agent:${agentId}` : `pane:${paneId}`;
}

export interface StepRecord {
  /** 最後に移った行の id（`worktree:/path`、`agent:3`、`pane:%12`） */
  row: string;
  /** 移った直後に表示されていたペイン */
  pane: string;
}

/**
 * 今いる行の id。記録のペインが今いるペインと同じなら記録の行（worktree の行へ移った直後など、ペインからは行が決まらない場合）。
 * 違えば（別の操作で動いたので）今いるペインから決める
 */
export function currentRowId(opts: { pane: string | undefined; agentId: string | undefined | null; record: StepRecord | null }) {
  if (!opts.pane) return undefined;
  if (opts.record && opts.record.pane === opts.pane) return opts.record.row;
  return rowIdOfPane(opts.pane, opts.agentId);
}

/** 今いる行の次（prev なら 1 つ前）。端では反対の端へ回り、今いる行が列に無ければ下は先頭・上は最後 */
export function stepFrom(rows: SidebarItem[], current: string | undefined, prev: boolean) {
  if (rows.length === 0) return undefined;
  const at = current === undefined ? -1 : rows.findIndex((r) => itemId(r) === current);
  if (at < 0) return prev ? rows[rows.length - 1] : rows[0];
  return rows[(at + (prev ? -1 : 1) + rows.length) % rows.length];
}
