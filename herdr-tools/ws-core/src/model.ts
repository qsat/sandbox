// ws-core のドメインモデル。I/O なし。
//
// 木の形: Workspace（本体リポジトリ）> Worktree（作業場所）> Agent（エージェント）
// 事実の出どころは herdr-core（エージェント）と git / ghq（作業場所）。ここではそれを正規化した形だけを扱う。
// どう見せるか・どう入るか（tmux / Herdr app）は知らない。

import { basename } from "@herdr-tools/utils/basename";
import { dirname } from "@herdr-tools/utils/dirname";
import { isUnderPath } from "@herdr-tools/utils/is-under-path";
import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";

export type AgentStatus = "working" | "blocked" | "idle" | "done" | "error" | "unknown";

/** 実行環境（AgentRuntime）が報告するエージェントの事実 */
export interface AgentRecord {
  /** 実行環境の中で不変の識別子 */
  id: string;
  name: string;
  cwd: string;
  status: AgentStatus;
  /** blocked の理由（permission / question / auth など） */
  kind?: string;
  msg?: string;
  /** 実行環境の中で生きているか（終了済みなら false） */
  alive: boolean;
  parent: string | null;
  /** 起動時に記録した本体リポジトリ・worktree のパス（無ければ cwd から推定する） */
  workspaceHint?: string;
  worktreeHint?: string;
  /** エージェントプログラム（Claude Code）の会話ID */
  sessionId?: string;
  /**
   * 実行環境は生きているがプログラムを失っている（シェルに置き換わった）。
   * undefined は「分からない」
   */
  programLost?: boolean;
}

/** パス1つについて WorkspaceSource が調べた結果 */
export interface PathInfo {
  path: string; // 問い合わせたパス（生の値）
  exists: boolean;
  /** バージョン管理下なら worktree のトップ（realpath 済み） */
  toplevel?: string;
  /** git の common dir（絶対パス）。本体リポジトリの特定に使う */
  commonDir?: string;
  branch?: string | null;
}

// ---------------------------------------------------------------------------
// 木
// ---------------------------------------------------------------------------

/** 木の中のエージェント: 事実から居場所の手がかりを除き、導出した状態を足したもの */
export type AgentNode = Omit<AgentRecord, "workspaceHint" | "worktreeHint" | "programLost"> & {
  /** 会話を再開すべき状態（実行環境は生きている・プログラムを失った・会話IDがある） */
  needsResume: boolean;
  /** 記録した worktree のディレクトリが存在しない（直接削除された worktree） */
  missingLocation: boolean;
};

export interface WorktreeNode {
  path: string;
  branch: string | null;
  exists: boolean;
  isMain: boolean;
  agents: AgentNode[];
}

export interface WorkspaceNode {
  path: string;
  name: string;
  worktrees: WorktreeNode[];
}

/** Workspace > Worktree > Agent の木 */
export interface Tree {
  workspaces: WorkspaceNode[];
}

// ---------------------------------------------------------------------------
// 状態の導出
// ---------------------------------------------------------------------------

export function needsResume(a: AgentRecord) {
  return a.alive && a.programLost === true && !!a.sessionId;
}

export function toAgentNode(a: AgentRecord, worktreeExists: boolean) {
  const { workspaceHint: _ws, worktreeHint, programLost: _lost, ...rest } = a;
  return { ...rest, needsResume: needsResume(a), missingLocation: !!worktreeHint && !worktreeExists };
}

/** 人の注意が要る順。小さいほど先 */
export function attentionRank(a: { status: AgentStatus; needsResume: boolean }) {
  if (a.status === "blocked") return 0;
  if (a.needsResume) return 1;
  if (a.status === "error") return 2;
  if (a.status === "idle") return 3;
  if (a.status === "working") return 4;
  if (a.status === "done") return 5;
  return 6;
}

export function byName(a: { name: string; id: string }, b: { name: string; id: string }) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** 注意が要る順、同じなら名前・id の順 */
export function byAttention(a: AgentNode, b: AgentNode) {
  return attentionRank(a) - attentionRank(b) || byName(a, b);
}

// ---------------------------------------------------------------------------
// パス（ドメインに関わるものだけ。汎用のパス操作は utils）
// ---------------------------------------------------------------------------

/** git common dir から本体リポジトリのパスを出す（.git の親。bare ならそのもの） */
export function workspacePathFromCommonDir(commonDir: string) {
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

/** 一覧での workspace の名前（ghq root からの相対、無理なら ~ 表記） */
export function displayName(path: string, root: string | undefined, home: string | undefined) {
  if (root && isUnderPath(path, root) && path !== trimTrailingSlash(root)) return path.slice(trimTrailingSlash(root).length + 1);
  if (home && isUnderPath(path, home)) return "~" + path.slice(trimTrailingSlash(home).length);
  return path;
}
