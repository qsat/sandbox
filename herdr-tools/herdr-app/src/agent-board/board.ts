import { agentTags } from "@herdr-tools/utils/agent-tags";
import { agentDisplayName } from "@herdr-tools/utils/agent-display-name";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import type { ListedAgent, ListedTree } from "@herdr-tools/tmux/list-json";
import { byAttention, type AgentStatus } from "@herdr-tools/ws-core/domain/agent";
import type { HcTerminal } from "@herdr-tools/ws-core/herdr-core/hc-terminal";

export const WS = "ws";

export type LiveTerminal = Pick<HcTerminal, "address" | "status">;

export type BoardAction = "go" | "new" | "resume" | "stop" | "close";

function withLiveStatus(a: ListedAgent, live: Map<string, LiveTerminal>) {
  const st = live.get(a.id)?.status;
  return st ? { ...a, status: st.state as AgentStatus, blockedReason: st.kind ?? undefined } : a;
}

export function boardRows(listJson: ListedTree, live: LiveTerminal[], collapsed: string[]) {
  const liveBy = new Map(live.map((t) => [t.address, t]));
  const folded = new Set(collapsed);
  return listJson.workspaces.flatMap((ws) => {
    const worktrees = ws.worktrees.map((wt) => ({ ...wt, agents: wt.agents.map((a) => withLiveStatus(a, liveBy)).sort(byAttention) }));
    const waiting = worktrees.flatMap((wt) => wt.agents).filter((a) => a.status === "blocked").length;
    const header = { kind: "workspace" as const, key: ws.path, label: ws.name, waiting, collapsed: folded.has(ws.path) };
    if (folded.has(ws.path)) return [header];
    return [
      header,
      ...worktrees.flatMap((wt) => [
        {
          kind: "worktree" as const,
          key: wt.path,
          label: worktreeDisplayName(wt),
          tags: worktreeTags({ ...wt, branch: null }, wt.tmux.session),
          isMain: wt.isMain,
          exists: wt.exists,
          hasSession: wt.tmux.session !== null,
        },
        ...wt.agents.map((a) => ({
          kind: "agent" as const,
          key: a.id,
          label: agentDisplayName(a),
          icon: statusIcon(a.status),
          status: statusLabel(a),
          rawStatus: a.status,
          tags: agentTags(a, a.tmux.attached),
          canResume: a.resumable,
          alive: a.alive,
          worktree: wt.path,
        })),
      ]),
    ];
  });
}

export type BoardRow = ReturnType<typeof boardRows>[number];

export function wsCommandFor(row: BoardRow, action: BoardAction): [string, string[]] | null {
  if (row.kind === "workspace") return null;
  switch (action) {
    case "go":
      return [WS, ["go", row.key, "--from-app"]];
    case "new":
      return [WS, ["new", row.kind === "worktree" ? row.key : row.worktree, "--attach", "--from-app"]];
    case "resume":
      return row.kind === "agent" && row.canResume ? [WS, ["resume", row.key]] : null;
    case "stop":
      return row.kind === "agent" ? [WS, ["stop", row.key]] : null;
    case "close":
      return row.kind === "worktree" && row.hasSession ? [WS, ["close", row.key]] : null;
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
