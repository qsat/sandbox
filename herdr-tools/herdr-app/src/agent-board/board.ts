import { agentTags } from "@herdr-tools/utils/agent-tags";
import { contextUsage } from "@herdr-tools/utils/context-usage";
import { agentDisplayName } from "@herdr-tools/utils/agent-display-name";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { sidebarItems, type LiveTerminal, type SidebarItem } from "@herdr-tools/tmux/sidebar-order";

import { wsNewArgs } from "../shared/ws-new";

export { WS, EMPTY_LIST, parseList } from "../shared/ws-list";

export type BoardAction = "go" | "new" | "resume" | "stop" | "close";

export type { LiveTerminal };

function toRow(item: SidebarItem) {
  switch (item.kind) {
    case "workspace":
      return { kind: "workspace" as const, key: item.key, label: item.ws.name, waiting: item.waiting, collapsed: item.collapsed };
    case "worktree": {
      const wt = item.wt;
      return {
        kind: "worktree" as const,
        key: item.key,
        label: worktreeDisplayName(wt),
        tags: worktreeTags({ ...wt, branch: null }, wt.tmux.session),
        isMain: wt.isMain,
        exists: wt.exists,
        hasSession: wt.tmux.session !== null,
      };
    }
    case "agent": {
      const a = item.agent;
      return {
        kind: "agent" as const,
        key: item.key,
        label: agentDisplayName(a),
        icon: statusIcon(a.status),
        status: statusLabel(a),
        rawStatus: a.status,
        tags: agentTags(a, a.tmux.attached),
        context: contextUsage(a),
        canResume: a.resumable,
        alive: a.alive,
        worktree: item.wt.path,
        isCurrentPane: a.tmux.current,
      };
    }
    case "pane":
      return { kind: "pane" as const, key: item.key, label: item.pane.command, worktree: item.wt.path, isCurrentPane: item.pane.current };
  }
}

/** 並びは tmux の sidebarItems（ws step と共通）が決め、ここでは表示用の行に変えるだけ */
export function boardRows(listJson: ListedTree, live: LiveTerminal[], collapsed: string[]) {
  return sidebarItems(listJson, live, collapsed).map(toRow);
}

export type BoardRow = ReturnType<typeof boardRows>[number];

export function rowId(row: BoardRow) {
  return `${row.kind}:${row.key}`;
}

export function moveSelection(rows: BoardRow[], current: string | null, delta: 1 | -1) {
  const selectable = rows.filter((r) => r.kind !== "workspace").map(rowId);
  if (selectable.length === 0) return null;
  const i = current ? selectable.indexOf(current) : -1;
  if (i < 0) return (delta === 1 ? selectable[0] : selectable.at(-1)) ?? null;
  return selectable[Math.min(selectable.length - 1, Math.max(0, i + delta))] ?? null;
}

export function wsArgsFor(row: BoardRow, action: BoardAction): string[] | null {
  if (row.kind === "workspace") return null;
  if (row.kind === "pane") return action === "go" ? ["go", row.key, "--from-app"] : null;
  switch (action) {
    case "go":
      return ["go", row.key, "--from-app"];
    case "new":
      return wsNewArgs(row.kind === "worktree" ? row.key : row.worktree);
    case "resume":
      return row.kind === "agent" && row.canResume ? ["resume", row.key] : null;
    case "stop":
      return row.kind === "agent" ? ["stop", row.key] : null;
    case "close":
      return row.kind === "worktree" && row.hasSession ? ["close", row.key] : null;
  }
}

export function wsArgsForModCommand(command: string): string[] | null {
  switch (command) {
    case "next":
      return ["next", "--from-app"];
    case "prev":
      return ["next", "--prev", "--from-app"];
    default:
      return null;
  }
}

/** worktree の変更量（`ws changes --json` の値）。ベースブランチから分かれた点と作業ツリーの差の +/− 行数 */
export interface ChangeAmount {
  added: number;
  deleted: number;
}

/** 変更量を読む worktree（場所が在るものだけ。並びは ws list のまま） */
export function changeTargets(listJson: ListedTree) {
  return listJson.workspaces.flatMap((ws) => ws.worktrees.filter((wt) => wt.exists).map((wt) => wt.path));
}

/** `ws changes --json` の出力を読む。読めない値・変更が無い worktree は入れない */
export function parseChanges(stdout: string): Record<string, ChangeAmount> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ChangeAmount> = {};
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    const a = v as Partial<ChangeAmount> | null;
    if (!a || typeof a.added !== "number" || typeof a.deleted !== "number") continue;
    if (a.added + a.deleted > 0) out[path] = { added: a.added, deleted: a.deleted };
  }
  return out;
}

export function toggleCollapsed(collapsed: string[], key: string) {
  const s = new Set(collapsed);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  return [...s];
}

const KEY_ACTIONS: Record<string, BoardAction> = { enter: "go", n: "new", "shift-r": "resume", s: "stop", x: "close" };

export function keyActionFor(rows: BoardRow[], selected: string | null, keystroke: string) {
  const action = KEY_ACTIONS[keystroke];
  const row = rows.find((r) => rowId(r) === selected);
  if (!action || !row) return null;
  const target = action === "close" && row.kind === "agent" ? rows.find((r) => r.kind === "worktree" && r.key === row.worktree) : row;
  return target && wsArgsFor(target, action) ? { action, row: target } : null;
}
