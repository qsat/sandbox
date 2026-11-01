// 行モデル: 木を「画面の1行ずつ」に平らにする。popup と ws list のテキスト出力で使う。

import { agentTags } from "@herdr-tools/utils/agent-tags";
import { basename } from "@herdr-tools/utils/basename";
import { statusIcon } from "@herdr-tools/utils/status-icon";
import { statusLabel } from "@herdr-tools/utils/status-label";
import type { Tag } from "@herdr-tools/utils/tag";
import { worktreeTags } from "@herdr-tools/utils/worktree-tags";
import { attentionRank, byAttention, type AgentNode, type Tree, type WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxIndex } from "../model";

export type Row =
  | { kind: "workspace"; depth: 0; text: string }
  | { kind: "worktree"; depth: 1; ref: string; worktree: WorktreeNode; text: string }
  | { kind: "agent"; depth: 2; ref: string; agent: AgentNode; worktree: WorktreeNode; text: string };

export interface ViewOptions {
  /** 注意が要るもの（blocked など）を先頭に */
  attentionFirst: boolean;
  color: boolean;
}

const STATUS_COLOR: Record<string, string> = { blocked: "\x1b[33m", error: "\x1b[31m", idle: "\x1b[36m", working: "\x1b[32m" };
const TONE: Record<Tag["tone"], string> = { strong: "\x1b[1m", muted: "\x1b[2m", danger: "\x1b[31m" };
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function paint(color: boolean, code: string, s: string): string {
  return color ? code + s + RESET : s;
}

function tagsText(tags: Tag[], color: boolean): string {
  return tags.map((t) => paint(color, TONE[t.tone], t.text)).join(" ");
}

function rankOfWorktree(wt: WorktreeNode): number {
  return Math.min(99, ...wt.agents.map(attentionRank));
}

export function agentLabel(a: AgentNode, idx: TmuxIndex, color: boolean): string {
  const sc = STATUS_COLOR[a.status] ?? GRAY;
  const tags = tagsText(agentTags(a, idx.isAttached(a.id)), color);
  return `${paint(color, sc, statusIcon(a.status))} ${a.id.padEnd(4)} ${a.name}  ${paint(color, sc, statusLabel(a))}${tags ? "  " + tags : ""}`;
}

export function worktreeLabel(wt: WorktreeNode, idx: TmuxIndex, color: boolean): string {
  const name = basename(wt.path);
  return [wt.isMain ? paint(color, BOLD, name) : name, tagsText(worktreeTags(wt, idx.sessionOf(wt.path)), color)].filter(Boolean).join(" ");
}

export function toRows(tree: Tree, idx: TmuxIndex, opts: ViewOptions): Row[] {
  const rows: Row[] = [];
  const workspaces = [...tree.workspaces];
  if (opts.attentionFirst) {
    const rank = (ws: (typeof workspaces)[number]) => Math.min(99, ...ws.worktrees.map(rankOfWorktree));
    workspaces.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  for (const ws of workspaces) {
    rows.push({ kind: "workspace", depth: 0, text: opts.color ? BOLD + ws.name + RESET : ws.name });
    const worktrees = [...ws.worktrees];
    if (opts.attentionFirst) worktrees.sort((a, b) => rankOfWorktree(a) - rankOfWorktree(b) || Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path));
    for (const wt of worktrees) {
      rows.push({ kind: "worktree", depth: 1, ref: wt.path, worktree: wt, text: worktreeLabel(wt, idx, opts.color) });
      const agents = [...wt.agents];
      if (opts.attentionFirst) agents.sort(byAttention);
      for (const a of agents) rows.push({ kind: "agent", depth: 2, ref: a.id, agent: a, worktree: wt, text: agentLabel(a, idx, opts.color) });
    }
  }
  return rows;
}

export function renderText(tree: Tree, idx: TmuxIndex, color: boolean): string {
  return toRows(tree, idx, { attentionFirst: false, color })
    .map((r) => "  ".repeat(r.depth) + r.text)
    .join("\n");
}

export function isSelectable(r: Row | undefined): boolean {
  return !!r && r.kind !== "workspace";
}

/** 選択位置を次の選択可能な行へ動かす */
export function moveSelection(rows: Row[], from: number, delta: 1 | -1): number {
  let i = from;
  for (let n = 0; n < rows.length; n++) {
    i += delta;
    if (i < 0 || i >= rows.length) return from;
    if (isSelectable(rows[i])) return i;
  }
  return from;
}

export function firstSelectable(rows: Row[]): number {
  const i = rows.findIndex(isSelectable);
  return i < 0 ? 0 : i;
}

/** 更新後も同じ対象を選んだままにする */
export function reselect(rows: Row[], ref: string | undefined): number {
  if (ref) {
    const i = rows.findIndex((r) => r.kind !== "workspace" && r.ref === ref);
    if (i >= 0) return i;
  }
  return firstSelectable(rows);
}
