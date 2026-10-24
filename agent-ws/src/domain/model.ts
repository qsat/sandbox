/**
 * ドメインの型と、状態を持たない純粋なルール
 *
 *   Repository ─< Worktree ─< Proc ── Session ─< Subagent
 *                                └─ 表示先 Pane（tmux）
 */
import type { NoticeKind } from "../redux/modules/notification/selector.ts";
import type { Session } from "../redux/modules/sessions/slice.ts";

export type Pid = number;
export type AgentKind = "claude" | "codex" | "aider" | "gemini" | "cursor" | "copilot" | "opencode" | "amp";

export interface Repository {
  name: string; // ghq root からの相対（github.com/owner/repo）
  path: string; // メイン worktree
  worktrees: Worktree[];
}

export interface Worktree {
  path: string;
  branch: string | null; // detached なら null
  head: string;
  isMain: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: number | null; // 変更ファイル数（表示対象だけ数える）
  processes: Proc[];
}

/** OS から見えるプロセス */
export interface ProcInfo {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
  cwd: string | null; // 読めなければ null
}

/** worktree に属するプロセス。エージェントなら agent / session が付く */
export interface Proc extends ProcInfo {
  cwd: string;
  agent: AgentKind | null;
  session: Session | null;
}

/** tmux のペイン（エージェントが表示されている場所） */
export interface Pane {
  id: string; // %12
  pid: Pid; // ペインで最初に起動したプロセス（通常はシェル）
  session: string;
  window: string;
  windowName: string;
  path: string;
  active: boolean; // クライアントが接続しているセッションの、いま表示されているペイン
}

/** 移動先: pid（の祖先）がいるペイン、なければ path にいるペイン */
export interface JumpTarget {
  title: string;
  name: string; // 新しいウィンドウを開くときの名前
  pid?: Pid;
  path?: string;
}

/** 人の注意が要る遷移の通知内容 */
export interface Notice {
  repo: string;
  branch?: string;
  kind: NoticeKind;
  reason?: string;
}

export type JumpResult =
  | { kind: "focused" | "found"; pane: Pane } // found: dry-run
  | { kind: "created"; path: string }
  | { kind: "notFound" | "failed"; title: string };

// ---------------------------------------------------------------------
// エージェント判定
// ---------------------------------------------------------------------
const AGENTS: [AgentKind, RegExp][] = [
  ["claude", /^claude$|@anthropic-ai\/claude-code|\/claude\/versions\//],
  ["codex", /^codex$|@openai\/codex/],
  ["aider", /^aider$/],
  ["gemini", /^gemini$|@google\/gemini-cli/],
  ["cursor", /^cursor-agent$/],
  ["copilot", /^copilot$|@github\/copilot/],
  ["opencode", /^opencode$/],
  ["amp", /^amp$|@sourcegraph\/amp/],
];
const RUNTIMES = /^(node|bun|deno|python3?(\.\d+)?|npx|uv|uvx)$/;
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 実行ファイル名で判定。node 等のランタイム経由ならスクリプトのパスで判定 */
export function detectAgent(command: string): AgentKind | null {
  const [exe = "", ...args] = command.split(/\s+/);
  const target = RUNTIMES.test(basename(exe)) ? (args.find((a) => !a.startsWith("-")) ?? "") : exe;
  return AGENTS.find(([, re]) => re.test(target) || re.test(basename(target)))?.[0] ?? null;
}

// ---------------------------------------------------------------------
// パス
// ---------------------------------------------------------------------
export const isUnder = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

/** ghq root からの相対名（root の外なら絶対パスのまま） */
export function repoName(path: string, roots: string[]): string {
  const root = roots.find((r) => r !== path && isUnder(path, r));
  return root ? path.slice(root.length).replace(/^\//, "") : path;
}

export function firstLine(s: string | undefined, max = 80): string | undefined {
  const line = s?.split("\n").map((l) => l.trim()).find(Boolean);
  return line && line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------
// 移動先のペイン特定
// ---------------------------------------------------------------------
/** pid 自身から祖先へ順に辿る */
export function* ancestry(pid: Pid | null | undefined, parentOf: (pid: Pid) => Pid | undefined): Generator<Pid> {
  for (let i = 0; pid && pid > 1 && i < 32; pid = parentOf(pid), i++) yield pid;
}

/** pid の祖先を辿って pane_pid に行き着くペイン。なければ path 配下にいるペイン（完全一致・アクティブ優先） */
export function findPane(t: JumpTarget, panes: Pane[], parentOf: (pid: Pid) => Pid | undefined): Pane | undefined {
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  for (const pid of ancestry(t.pid, parentOf)) {
    const hit = byPid.get(pid);
    if (hit) return hit;
  }
  const path = t.path;
  if (!path) return undefined;
  const score = (p: Pane) => Number(p.path === path) * 2 + Number(p.active);
  return panes.filter((p) => isUnder(p.path, path)).sort((a, b) => score(b) - score(a))[0];
}
