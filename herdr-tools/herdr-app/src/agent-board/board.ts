// agent-board の純粋なロジック: ws list --json の木に terminals() の即時の状態を重ね、画面の行にする。
// Herdr app の API には触らない（bun test で検査する）。

import { agentTags } from "@herdr-tools/utils/agent-tags";
import { basename } from "@herdr-tools/utils/basename";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import type { Tag } from "@herdr-tools/utils/tag";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import { attentionRank, type AgentNode, type AgentStatus, type WorkspaceNode, type WorktreeNode } from "@herdr-tools/ws-core/model";

export const WS = "ws";

/** ws list --json の形（ws-core の木に、tmux クライアントの情報が tmux キーで添えられている） */
export interface ListedAgent extends AgentNode {
  tmux?: { attached: boolean; panes: string[] };
}
export interface ListedWorktree extends Omit<WorktreeNode, "agents"> {
  tmux?: { session: { name: string; attached: boolean } | null };
  agents: ListedAgent[];
}
export interface ListedWorkspace extends Omit<WorkspaceNode, "worktrees"> {
  worktrees: ListedWorktree[];
}
export interface ListedTree {
  workspaces: ListedWorkspace[];
}

/** terminals() の要素（hc ls --json と同じ形。status は単語かオブジェクト） */
export interface LiveTerminal {
  address?: string;
  status?: string | { state?: string; kind?: string };
}

export type BoardRow =
  | { kind: "workspace"; key: string; label: string; waiting: number; collapsed: boolean }
  | { kind: "worktree"; key: string; label: string; tags: Tag[]; isMain: boolean; exists: boolean }
  | { kind: "agent"; key: string; label: string; icon: string; status: string; rawStatus: AgentStatus; tags: Tag[]; canResume: boolean; worktree: string };

export type BoardAction = "go" | "new" | "resume";

function overlay(a: ListedAgent, live: Map<string, { status?: string; kind?: string }>): ListedAgent {
  const l = live.get(a.id);
  return l?.status ? { ...a, status: l.status as AgentStatus, kind: l.kind ?? a.kind } : a;
}

/**
 * @param tree      ws list --json の結果
 * @param live      terminals() の結果。address は ws のエージェント id と同じ
 * @param collapsed 折り畳んだ workspace のパス
 */
export function boardRows(tree: ListedTree, live: LiveTerminal[], collapsed: string[]): BoardRow[] {
  const liveBy = new Map<string, { status?: string; kind?: string }>();
  for (const t of live) {
    if (!t?.address) continue;
    const st = typeof t.status === "object" && t.status ? t.status : { state: t.status };
    liveBy.set(t.address, { status: st.state, kind: st.kind });
  }
  const folded = new Set(collapsed);
  const rows: BoardRow[] = [];
  for (const ws of tree.workspaces) {
    const worktrees = ws.worktrees.map((wt) => ({
      ...wt,
      agents: wt.agents.map((a) => overlay(a, liveBy)).sort((x, y) => attentionRank(x) - attentionRank(y) || x.name.localeCompare(y.name)),
    }));
    const waiting = worktrees.reduce((n, wt) => n + wt.agents.filter((a) => a.status === "blocked" || a.needsResume).length, 0);
    rows.push({ kind: "workspace", key: ws.path, label: ws.name, waiting, collapsed: folded.has(ws.path) });
    if (folded.has(ws.path)) continue;
    for (const wt of worktrees) {
      rows.push({ kind: "worktree", key: wt.path, label: basename(wt.path), tags: worktreeTags(wt, wt.tmux?.session), isMain: wt.isMain, exists: wt.exists });
      for (const a of wt.agents) {
        rows.push({
          kind: "agent",
          key: a.id,
          label: `${a.id} ${a.name}`,
          icon: statusIcon(a.status),
          status: statusLabel(a),
          rawStatus: a.status,
          tags: agentTags(a, a.tmux?.attached),
          canResume: a.needsResume,
          worktree: wt.path,
        });
      }
    }
  }
  return rows;
}

/** 行の操作 → ws の呼び出し（[コマンド, 引数]） */
export function commandFor(row: BoardRow, action: BoardAction): [string, string[]] | null {
  if (row.kind === "workspace") return null;
  switch (action) {
    case "go":
      return [WS, ["go", row.key, "--from-app"]];
    case "new":
      return [WS, ["new", row.kind === "worktree" ? row.key : row.worktree, "--attach", "--from-app"]];
    case "resume":
      return row.kind === "agent" && row.canResume ? [WS, ["resume", row.key]] : null;
  }
}

export function toggleCollapsed(collapsed: string[], key: string): string[] {
  const s = new Set(collapsed);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  return [...s];
}

export function parseList(stdout: string): ListedTree {
  try {
    const v = JSON.parse(stdout);
    return v && Array.isArray(v.workspaces) ? v : { workspaces: [] };
  } catch {
    return { workspaces: [] };
  }
}
