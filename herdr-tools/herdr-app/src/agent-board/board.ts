// agent-board の純粋なロジック: ws list --json の木に terminals() の即時の状態を重ね、画面の行にする。
// Herdr app の API には触らない（bun test で検査する）。

import { agentTags } from "@herdr-tools/utils/agent-tags";
import { basename } from "@herdr-tools/utils/basename";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import type { ListedAgent, ListedTree } from "@herdr-tools/tmux/json";
import type { HcTerminal } from "@herdr-tools/ws-core/herdr-core/terminal";
import { byAttention, type AgentStatus } from "@herdr-tools/ws-core/model";

export const WS = "ws";

/** terminals() の要素（herdr-core の Terminal と同じ形） */
export type LiveTerminal = Pick<HcTerminal, "address" | "status">;

export type BoardAction = "go" | "new" | "resume";

/** ws list の結果に、terminals() の即時の状態を重ねる */
function overlay(a: ListedAgent, live: Map<string, LiveTerminal>) {
  const st = live.get(a.id)?.status;
  return st ? { ...a, status: st.state as AgentStatus, kind: st.kind ?? undefined } : a;
}

/**
 * @param tree      ws list --json の結果
 * @param live      terminals() の結果。address は ws のエージェント id と同じ
 * @param collapsed 折り畳んだ workspace のパス
 */
export function boardRows(tree: ListedTree, live: LiveTerminal[], collapsed: string[]) {
  const liveBy = new Map(live.map((t) => [t.address, t]));
  const folded = new Set(collapsed);
  return tree.workspaces.flatMap((ws) => {
    const worktrees = ws.worktrees.map((wt) => ({ ...wt, agents: wt.agents.map((a) => overlay(a, liveBy)).sort(byAttention) }));
    const waiting = worktrees.flatMap((wt) => wt.agents).filter((a) => a.status === "blocked" || a.needsResume).length;
    const header = { kind: "workspace" as const, key: ws.path, label: ws.name, waiting, collapsed: folded.has(ws.path) };
    if (folded.has(ws.path)) return [header];
    return [
      header,
      ...worktrees.flatMap((wt) => [
        { kind: "worktree" as const, key: wt.path, label: basename(wt.path), tags: worktreeTags(wt, wt.tmux.session), isMain: wt.isMain, exists: wt.exists },
        ...wt.agents.map((a) => ({
          kind: "agent" as const,
          key: a.id,
          label: `${a.id} ${a.name}`,
          icon: statusIcon(a.status),
          status: statusLabel(a),
          rawStatus: a.status,
          tags: agentTags(a, a.tmux.attached),
          canResume: a.needsResume,
          worktree: wt.path,
        })),
      ]),
    ];
  });
}

export type BoardRow = ReturnType<typeof boardRows>[number];

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

export function toggleCollapsed(collapsed: string[], key: string) {
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
