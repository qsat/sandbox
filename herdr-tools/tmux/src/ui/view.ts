// 行モデル: 木を「画面の1行ずつ」に平らにする。popup と ws list のテキスト出力で使う。

import { attentionRank, basename, type AgentNode, type Tree, type WorktreeNode } from "@herdr-tools/ws-core";
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

const ICON: Record<string, string> = {
  blocked: "▲",
  error: "✖",
  idle: "○",
  working: "●",
  done: "✔",
  unknown: "?",
};

const COLOR: Record<string, string> = {
  blocked: "\x1b[33m",
  error: "\x1b[31m",
  idle: "\x1b[36m",
  working: "\x1b[32m",
  done: "\x1b[90m",
  unknown: "\x1b[90m",
};
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function rankOfWorktree(wt: WorktreeNode): number {
  return Math.min(99, ...wt.agents.map(attentionRank));
}

export function agentLabel(a: AgentNode, idx: TmuxIndex, color: boolean): string {
  const c = (code: string, s: string) => (color ? code + s + RESET : s);
  const status = a.status === "blocked" && a.kind ? `blocked(${a.kind})` : a.status;
  const tags: string[] = [];
  if (a.needsResume) tags.push(c(BOLD, "要再開"));
  if (!idx.isAttached(a.id)) tags.push(c(DIM, "未attach"));
  if (a.missingLocation) tags.push(c(COLOR.error!, "場所消失"));
  if (a.parent) tags.push(c(DIM, `子:${a.parent}`));
  if (!a.alive) tags.push(c(DIM, "終了"));
  const icon = c(COLOR[a.status] ?? "", ICON[a.status] ?? "?");
  return `${icon} ${a.id.padEnd(4)} ${a.name}  ${c(COLOR[a.status] ?? "", status)}${tags.length ? "  " + tags.join(" ") : ""}`;
}

export function worktreeLabel(wt: WorktreeNode, idx: TmuxIndex, color: boolean): string {
  const c = (code: string, s: string) => (color ? code + s + RESET : s);
  const name = basename(wt.path);
  const parts = [wt.isMain ? c(BOLD, name) : name];
  if (wt.branch) parts.push(c(DIM, `[${wt.branch}]`));
  const session = idx.sessionOf(wt.path);
  if (session) parts.push(c(DIM, session.attached ? "tmux*" : "tmux"));
  if (!wt.exists) parts.push(c(COLOR.error!, "場所消失"));
  return parts.join(" ");
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
      if (opts.attentionFirst) agents.sort((a, b) => attentionRank(a) - attentionRank(b) || a.name.localeCompare(b.name));
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
