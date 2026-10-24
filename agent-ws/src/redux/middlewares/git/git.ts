import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { attempt } from "../../../lib/attempt.ts";
import type { Worktree } from "../../types/workspace.ts";
import { lines, realPath, run } from "../shared/shell.ts";

/** ghq のルート（ghq コマンド → GHQ_ROOT → git config ghq.root → ~/ghq） */
export function ghqRoots(): string[] {
  const roots = [
    lines(run("ghq", ["root", "--all"])),
    (process.env.GHQ_ROOT ?? "").split(delimiter).filter(Boolean),
    lines(run("git", ["config", "--get-all", "ghq.root"])).map((p) => p.replace(/^~/, homedir())),
  ].find((c) => c.length);
  return (roots ?? [join(homedir(), "ghq")]).map(realPath);
}

/** ghq 管理下のリポジトリ（ghq が無ければ <root>/<host>/<owner>/<repo> を走査） */
export function listRepoPaths(roots: string[], query?: string): string[] {
  const viaGhq = run("ghq", ["list", "-p", ...[query].filter((q) => q !== undefined)]);
  if (viaGhq !== null) return lines(viaGhq).map(realPath);
  return roots.flatMap((r) => scan(r, 3)).filter((p) => !query || p.includes(query));
}

const isDir = (p: string) => attempt(() => statSync(p).isDirectory(), false);

/** .git が「ディレクトリ」のものだけ拾う（.git ファイルの worktree はリポジトリ側から辿る） */
function scan(dir: string, depth: number): string[] {
  if (isDir(join(dir, ".git"))) return [dir];
  if (depth === 0) return [];
  return attempt(() => readdirSync(dir), [])
    .filter((e) => !e.startsWith(".") && e !== "node_modules")
    .map((e) => join(dir, e))
    .filter(isDir)
    .flatMap((p) => scan(p, depth - 1));
}

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
    path: realPath(kv.get("worktree") ?? ""),
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

export function listWorktrees(repoPath: string): Worktree[] {
  const out = run("git", ["worktree", "list", "--porcelain"], repoPath)?.trim();
  if (!out) return [];
  return out.split(/\n\n+/).map(worktreeOf);
}

export function countDirty(path: string): number | null {
  const out = run("git", ["status", "--porcelain"], path);
  if (out === null) return null;
  return lines(out).length;
}

export const currentBranch = (path: string) => run("git", ["branch", "--show-current"], path)?.trim() || undefined;
