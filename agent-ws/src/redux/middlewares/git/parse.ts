/**
 * git の出力の解析（純粋な関数。パスの実体化は git.ts が行う）
 */
import type { Worktree } from "../../types/workspace.ts";

/** "key value" の行の並び → key → value（値の無い行は空文字） */
const fieldsOf = (block: string) =>
  new Map(
    block.split("\n").map((line) => {
      const [key = "", ...rest] = line.split(" ");
      return [key, rest.join(" ")] as const;
    }),
  );

/** `git worktree list --porcelain` の1ブロック（先頭がメイン） */
function worktreeOf(block: string, i: number): Worktree {
  const kv = fieldsOf(block);
  return {
    path: kv.get("worktree") ?? "",
    branch: kv.get("branch")?.replace(/^refs\/heads\//, "") ?? null,
    head: (kv.get("HEAD") ?? "").slice(0, 8),
    isMain: i === 0,
    bare: kv.has("bare"),
    locked: kv.has("locked"),
    prunable: kv.has("prunable"),
    dirty: null,
    agents: [],
  };
}

/** `git worktree list --porcelain` の出力 → worktree（空なら無し） */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out = porcelain.trim();
  if (!out) return [];
  return out.split(/\n\n+/).map(worktreeOf);
}
