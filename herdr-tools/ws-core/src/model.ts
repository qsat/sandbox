// ws-core のドメインモデル。I/O なし。
//
// 木の形: Workspace（本体リポジトリ）> Worktree（作業場所）> Agent（エージェント）
// エージェントをどこで動かすか（herdr-core など）や、どう見せるか（tmux / Herdr app など）は知らない。
// それらはポート（ports.ts）の向こう側にいる。

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

export interface AgentNode {
  id: string;
  name: string;
  status: AgentStatus;
  kind?: string;
  msg?: string;
  alive: boolean;
  parent: string | null;
  cwd: string;
  sessionId?: string;
  /** 会話を再開すべき状態（実行環境は生きている・プログラムを失った・会話IDがある） */
  needsResume: boolean;
  /** 記録した worktree のディレクトリが存在しない（直接削除された worktree） */
  missingLocation: boolean;
}

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

export interface Tree {
  workspaces: WorkspaceNode[];
}

// ---------------------------------------------------------------------------
// 状態の導出
// ---------------------------------------------------------------------------

export function needsResume(a: AgentRecord): boolean {
  return a.alive && a.programLost === true && !!a.sessionId;
}

/** 人の注意が要る順。小さいほど先 */
export function attentionRank(a: { status: AgentStatus; needsResume: boolean }): number {
  if (a.status === "blocked") return 0;
  if (a.needsResume) return 1;
  if (a.status === "error") return 2;
  if (a.status === "idle") return 3;
  if (a.status === "working") return 4;
  if (a.status === "done") return 5;
  return 6;
}

// ---------------------------------------------------------------------------
// パス
// ---------------------------------------------------------------------------

export function basename(p: string): string {
  const t = p.replace(/\/+$/g, "");
  const i = t.lastIndexOf("/");
  return i < 0 ? t : t.slice(i + 1);
}

export function dirname(p: string): string {
  const t = p.replace(/\/+$/g, "");
  const i = t.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return t.slice(0, i);
}

/**
 * child が base そのものか base/ 配下か。
 * 単純な前方一致だと ~/ghq/x/repo と ~/ghq/x/repo=branch が混ざるので、境界で判定する。
 */
export function isUnderPath(child: string, base: string): boolean {
  const b = base.replace(/\/+$/g, "");
  return child === b || child.startsWith(b + "/");
}

/** candidates のうち p を含む最も深いもの */
export function findContainingPath(p: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const c of candidates) {
    if (isUnderPath(p, c) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

/** git common dir から本体リポジトリのパスを出す（.git の親。bare ならそのもの） */
export function workspacePathFromCommonDir(commonDir: string): string {
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

export function displayName(path: string, root: string | undefined, home: string | undefined): string {
  if (root && isUnderPath(path, root) && path !== root.replace(/\/+$/g, "")) {
    return path.slice(root.replace(/\/+$/g, "").length + 1);
  }
  if (home && isUnderPath(path, home)) return "~" + path.slice(home.replace(/\/+$/g, "").length);
  return path;
}
