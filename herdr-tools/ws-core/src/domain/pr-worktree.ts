import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";

/**
 * プルリクエストのブランチの worktree を用意する（ws pr）ときの判断（I/O なし）。
 * worktree が無ければ作り、あれば早送りできるときだけ最新にする。エージェントは起動しない
 */

/** プルリクエストのブランチ（`gh pr view --json number,headRefName,isCrossRepository`） */
export interface PrBranch {
  number: number;
  head: string;
  /** フォークからのプルリクエスト（ブランチが origin に無い） */
  crossRepository: boolean;
}

/**
 * git の引数として安全なブランチ名だけを受け付ける（`-` で始まらない、`..` や空白・制御文字を含まない）。
 * git check-ref-format より狭いが、GitHub のブランチ名で困ることはまず無い
 */
const BRANCH_PATTERN = /^[\w][\w./+-]*$/;

export function isSafeBranchName(name: string) {
  return BRANCH_PATTERN.test(name) && !name.includes("..") && !name.endsWith(".lock") && !name.endsWith("/") && !name.endsWith(".");
}

/** `gh pr view --json number,headRefName,isCrossRepository` の出力を読む。読めなければ null */
export function parsePrBranch(stdout: string): PrBranch | null {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    return null;
  }
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (typeof r.number !== "number" || typeof r.headRefName !== "string" || !r.headRefName) return null;
  return { number: r.number, head: r.headRefName, crossRepository: r.isCrossRepository === true };
}

/**
 * 新しく作る worktree の場所。本体の横に「本体のフォルダー名=ブランチ名」で置く（gwq で作る worktree と同じ並び。例: /g/o/api=feat-auth）。
 * ブランチ名の `/` は `-` にする
 */
export function prWorktreePath(mainRepository: string, branch: string) {
  return `${trimTrailingSlash(mainRepository)}=${branch.replaceAll("/", "-")}`;
}

/** `git worktree list --porcelain` から、そのブランチを checkout している worktree の場所を探す。無ければ null */
export function worktreeOfBranch(porcelain: string, branch: string) {
  for (const block of porcelain.split("\n\n")) {
    const lines = block.split("\n");
    if (lines.some((l) => l.startsWith("prunable"))) continue;
    if (!lines.includes(`branch refs/heads/${branch}`)) continue;
    const wt = lines.find((l) => l.startsWith("worktree "));
    if (wt) return wt.slice("worktree ".length);
  }
  return null;
}

/** 既にある worktree の状態（origin のブランチと比べる） */
export interface WorktreeState {
  /** 追跡しているファイルに未コミットの変更がある（追跡されていないファイルは数えない。早送りを止めないため） */
  dirty: boolean;
  /** origin のブランチに無いコミットの数（push 前） */
  ahead: number;
  /** 手元に無い origin のコミットの数 */
  behind: number;
}

export type UpdateDecision = "fast-forward" | "up-to-date" | "skip-dirty" | "skip-ahead";

/**
 * 最新にするか。早送り（--ff-only）できるときだけ進める。未コミットの変更や push 前のコミットがあれば
 * （エージェントが作業中かもしれないので）触らない。上書きや rebase はしない
 */
export function updateDecision(s: WorktreeState): UpdateDecision {
  if (s.ahead > 0) return "skip-ahead";
  if (s.behind === 0) return "up-to-date";
  if (s.dirty) return "skip-dirty";
  return "fast-forward";
}

export type PrWorktreeOutcome =
  | { kind: "created"; path: string; branch: string }
  | { kind: "updated"; path: string; commits: number }
  | { kind: "up-to-date"; path: string }
  | { kind: "skip-dirty"; path: string }
  | { kind: "skip-ahead"; path: string; commits: number };

export function prWorktreeMessage(o: PrWorktreeOutcome) {
  switch (o.kind) {
    case "created":
      return `worktree を作りました（${o.branch}）: ${o.path}`;
    case "updated":
      return `最新にしました（${o.commits} コミット進めた）: ${o.path}`;
    case "up-to-date":
      return `最新です: ${o.path}`;
    case "skip-dirty":
      return `未コミットの変更があるので更新しません: ${o.path}`;
    case "skip-ahead":
      return `push 前のコミットが ${o.commits} 個あるので更新しません: ${o.path}`;
  }
}

/** `git rev-list --left-right --count HEAD...<upstream>` の出力（「ahead TAB behind」）を読む */
export function parseAheadBehind(stdout: string) {
  const [ahead = "0", behind = "0"] = stdout.trim().split(/\s+/);
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}
