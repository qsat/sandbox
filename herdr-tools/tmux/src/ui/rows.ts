import { agentDisplayName } from "@herdr-tools/utils/agent-display-name";
import { agentTags } from "@herdr-tools/utils/agent-tags";
import { contextUsage } from "@herdr-tools/utils/context-usage";
import { basename } from "@herdr-tools/utils/basename";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import type { Tag } from "@herdr-tools/utils/tag";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import { usageSegments } from "@herdr-tools/utils/usage-segments";
import { attentionRank, byAttention, type AgentNode, type ClaudeUsage, type Tree, type WorkspaceNode, type WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxIndex } from "../tmux-index";

interface RowOptions {
  attentionFirst: boolean;
  color: boolean;
  keyHints?: boolean;
  look?: "plain" | "board";
}

const RESUME_HINT = "R で再開";

const ESC = "\x1b";
const truecolor = (hex: string) => `${ESC}[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
const STATUS_COLOR: Record<string, string> = { blocked: `${ESC}[33m`, error: `${ESC}[31m`, idle: `${ESC}[36m`, working: `${ESC}[32m`, done: `${ESC}[34m` };
const TONE: Record<Tag["tone"], string> = { strong: `${ESC}[1m`, muted: `${ESC}[2m`, danger: `${ESC}[31m` };
const GRAY = `${ESC}[90m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const BOARD_REPOSITORY = BOLD + truecolor("#8fc232");
const BOARD_BRANCH = truecolor("#8f8728");
const BOARD_BRANCH_MAIN = BOLD + BOARD_BRANCH;

function paint(color: boolean, code: string, s: string) {
  return color ? code + s + RESET : s;
}

function tagsText(tags: Tag[], color: boolean) {
  return tags.map((t) => paint(color, TONE[t.tone], t.text)).join(" ");
}

function joinParts(parts: string[], gap: string) {
  return parts.filter(Boolean).join(gap);
}

function rankOfWorktree(wt: WorktreeNode) {
  return Math.min(99, ...wt.agents.map(attentionRank));
}

function contextTags(a: AgentNode): Tag[] {
  const ctx = contextUsage(a);
  return ctx ? [ctx] : [];
}

function hintTags(a: AgentNode, keyHints: boolean): Tag[] {
  return keyHints && a.resumable ? [{ text: RESUME_HINT, tone: "muted" }] : [];
}

export function agentLabel(a: AgentNode, idx: TmuxIndex, color: boolean, keyHints = false) {
  const sc = STATUS_COLOR[a.status] ?? GRAY;
  const tags = tagsText([...contextTags(a), ...agentTags(a, idx.isAttached(a.id)), ...hintTags(a, keyHints)], color);
  return `${paint(color, sc, statusIcon(a.status))} ${a.id.padEnd(4)} ${a.name}  ${paint(color, sc, statusLabel(a))}${tags ? "  " + tags : ""}`;
}

function boardAgentLabel(a: AgentNode, idx: TmuxIndex, color: boolean, keyHints = false) {
  const sc = STATUS_COLOR[a.status] ?? GRAY;
  const tags = tagsText([...contextTags(a), ...agentTags(a, idx.isAttached(a.id)), ...hintTags(a, keyHints)], color);
  return joinParts([paint(color, BOLD, agentDisplayName(a)), paint(color, sc, statusIcon(a.status)), paint(color, sc, statusLabel(a)), tags], " ");
}

function paneLabel(command: string, color: boolean) {
  return paint(color, GRAY, command);
}

export function worktreeLabel(wt: WorktreeNode, idx: TmuxIndex, color: boolean) {
  const name = basename(wt.path);
  return joinParts([wt.isMain ? paint(color, BOLD, name) : name, tagsText(worktreeTags(wt, idx.sessionOf(wt.path)), color)], " ");
}

function boardWorktreeLabel(wt: WorktreeNode, idx: TmuxIndex, color: boolean) {
  const session = idx.sessionOf(wt.path);
  const tags = tagsText(worktreeTags({ ...wt, branch: null }, session), color);
  const nameColor = !session ? GRAY : wt.isMain ? BOARD_BRANCH_MAIN : BOARD_BRANCH;
  return joinParts([paint(color, nameColor, worktreeDisplayName(wt)), tags], " ");
}

export function toRows(tree: Tree, idx: TmuxIndex, opts: RowOptions) {
  const board = opts.look === "board";
  const sorted = <T>(xs: T[], cmp: (a: T, b: T) => number) => (opts.attentionFirst ? [...xs].sort(cmp) : xs);
  const rankOfWorkspace = (ws: WorkspaceNode) => Math.min(99, ...ws.worktrees.map(rankOfWorktree));
  const workspaces = sorted(tree.workspaces, (a, b) => rankOfWorkspace(a) - rankOfWorkspace(b) || a.name.localeCompare(b.name));
  return workspaces.flatMap((ws, i) => [
    ...(board && i > 0 ? [{ kind: "spacer" as const, depth: 0, text: "" }] : []),
    { kind: "workspace" as const, depth: 0, text: paint(opts.color, board ? BOARD_REPOSITORY : BOLD, ws.name) },
    ...sorted(ws.worktrees, (a, b) => rankOfWorktree(a) - rankOfWorktree(b) || Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path)).flatMap((wt) => [
      {
        kind: "worktree" as const,
        depth: 1,
        ref: wt.path,
        worktree: wt,
        text: (board ? boardWorktreeLabel : worktreeLabel)(wt, idx, opts.color),
      },
      ...sorted(wt.agents, byAttention).map((a) => ({
        kind: "agent" as const,
        depth: 2,
        ref: a.id,
        agent: a,
        worktree: wt,
        isCurrentPane: idx.isCurrentAgent(a.id),
        text: (board ? boardAgentLabel : agentLabel)(a, idx, opts.color, opts.keyHints),
      })),
      ...idx.otherPanesOf(wt.path).map((p) => ({
        kind: "pane" as const,
        depth: 2,
        ref: p.paneId,
        worktree: wt,
        isCurrentPane: p.current,
        text: paneLabel(p.command, opts.color),
      })),
    ]),
  ]);
}

export type Row = ReturnType<typeof toRows>[number];
type SelectableRow = Extract<Row, { kind: "worktree" | "agent" | "pane" }>;

export function usageLine(usage: ClaudeUsage, color: boolean, nowEpochSec = Math.floor(Date.now() / 1000)) {
  return tagsText(usageSegments(usage, nowEpochSec), color);
}

export function renderText(tree: Tree, idx: TmuxIndex, usage: ClaudeUsage, color: boolean) {
  const rows = toRows(tree, idx, { attentionFirst: false, color }).map((r) => "  ".repeat(r.depth) + r.text);
  return [usageLine(usage, color), ...rows].filter(Boolean).join("\n");
}

export function isSelectable(r: Row | undefined): r is SelectableRow {
  return !!r && (r.kind === "worktree" || r.kind === "agent" || r.kind === "pane");
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
    const i = rows.findIndex((r) => isSelectable(r) && r.ref === ref);
    if (i >= 0) return i;
  }
  return firstSelectable(rows);
}
