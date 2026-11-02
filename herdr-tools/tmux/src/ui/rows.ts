import { agentTags } from "@herdr-tools/utils/agent-tags";
import { basename } from "@herdr-tools/utils/basename";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import type { Tag } from "@herdr-tools/utils/tag";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import { attentionRank, byAttention, type AgentNode, type Tree, type WorkspaceNode, type WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxIndex } from "../tmux-index";

interface RowOptions {
  attentionFirst: boolean;
  color: boolean;
  keyHints?: boolean;
}

const RESUME_HINT = "R で再開";

const STATUS_COLOR: Record<string, string> = { blocked: "\x1b[33m", error: "\x1b[31m", idle: "\x1b[36m", working: "\x1b[32m" };
const TONE: Record<Tag["tone"], string> = { strong: "\x1b[1m", muted: "\x1b[2m", danger: "\x1b[31m" };
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function paint(color: boolean, code: string, s: string) {
  return color ? code + s + RESET : s;
}

function tagsText(tags: Tag[], color: boolean) {
  return tags.map((t) => paint(color, TONE[t.tone], t.text)).join(" ");
}

function rankOfWorktree(wt: WorktreeNode) {
  return Math.min(99, ...wt.agents.map(attentionRank));
}

export function agentLabel(a: AgentNode, idx: TmuxIndex, color: boolean, keyHints = false) {
  const sc = STATUS_COLOR[a.status] ?? GRAY;
  const hints: Tag[] = keyHints && a.resumable ? [{ text: RESUME_HINT, tone: "muted" }] : [];
  const tags = tagsText([...agentTags(a, idx.isAttached(a.id)), ...hints], color);
  return `${paint(color, sc, statusIcon(a.status))} ${a.id.padEnd(4)} ${a.name}  ${paint(color, sc, statusLabel(a))}${tags ? "  " + tags : ""}`;
}

export function worktreeLabel(wt: WorktreeNode, idx: TmuxIndex, color: boolean) {
  const name = basename(wt.path);
  return [wt.isMain ? paint(color, BOLD, name) : name, tagsText(worktreeTags(wt, idx.sessionOf(wt.path)), color)].filter(Boolean).join(" ");
}

export function toRows(tree: Tree, idx: TmuxIndex, opts: RowOptions) {
  const sorted = <T>(xs: T[], cmp: (a: T, b: T) => number) => (opts.attentionFirst ? [...xs].sort(cmp) : xs);
  const rankOfWorkspace = (ws: WorkspaceNode) => Math.min(99, ...ws.worktrees.map(rankOfWorktree));
  return sorted(tree.workspaces, (a, b) => rankOfWorkspace(a) - rankOfWorkspace(b) || a.name.localeCompare(b.name)).flatMap((ws) => [
    { kind: "workspace" as const, depth: 0, text: paint(opts.color, BOLD, ws.name) },
    ...sorted(ws.worktrees, (a, b) => rankOfWorktree(a) - rankOfWorktree(b) || Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path)).flatMap((wt) => [
      { kind: "worktree" as const, depth: 1, ref: wt.path, worktree: wt, text: worktreeLabel(wt, idx, opts.color) },
      ...sorted(wt.agents, byAttention).map((a) => ({ kind: "agent" as const, depth: 2, ref: a.id, agent: a, worktree: wt, text: agentLabel(a, idx, opts.color, opts.keyHints) })),
    ]),
  ]);
}

export type Row = ReturnType<typeof toRows>[number];

export function renderText(tree: Tree, idx: TmuxIndex, color: boolean) {
  return toRows(tree, idx, { attentionFirst: false, color })
    .map((r) => "  ".repeat(r.depth) + r.text)
    .join("\n");
}

export function isSelectable(r: Row | undefined) {
  return !!r && r.kind !== "workspace";
}

export function nextSelectable(rows: Row[], from: number, delta: 1 | -1) {
  let i = from;
  for (let n = 0; n < rows.length; n++) {
    i += delta;
    if (i < 0 || i >= rows.length) return from;
    if (isSelectable(rows[i])) return i;
  }
  return from;
}

export function firstSelectable(rows: Row[]) {
  const i = rows.findIndex(isSelectable);
  return i < 0 ? 0 : i;
}

export function keepSelectionOn(rows: Row[], ref: string | undefined) {
  if (ref) {
    const i = rows.findIndex((r) => r.kind !== "workspace" && r.ref === ref);
    if (i >= 0) return i;
  }
  return firstSelectable(rows);
}
