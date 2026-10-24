import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Worktree } from "../types/workspace.ts";
import { lines, realPath, run } from "./shell.ts";

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
  const viaGhq = run("ghq", ["list", "-p", ...(query ? [query] : [])]);
  if (viaGhq !== null) return lines(viaGhq).map(realPath);
  const found = roots.flatMap((r) => scan(r, 3));
  return query ? found.filter((p) => p.includes(query)) : found;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** .git が「ディレクトリ」のものだけ拾う（.git ファイルの worktree はリポジトリ側から辿る） */
function scan(dir: string, depth: number): string[] {
  if (isDir(join(dir, ".git"))) return [dir];
  if (depth === 0) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    /* 読めない */
  }
  return entries
    .filter((e) => !e.startsWith(".") && e !== "node_modules")
    .map((e) => join(dir, e))
    .filter(isDir)
    .flatMap((p) => scan(p, depth - 1));
}

export function listWorktrees(repoPath: string): Worktree[] {
  const out = run("git", ["worktree", "list", "--porcelain"], repoPath)?.trim();
  if (!out) return [];
  return out.split(/\n\n+/).map((block, i) => {
    const kv = new Map<string, string>();
    for (const line of block.split("\n")) {
      const at = line.indexOf(" ");
      kv.set(at < 0 ? line : line.slice(0, at), at < 0 ? "" : line.slice(at + 1));
    }
    return {
      path: realPath(kv.get("worktree") ?? ""),
      branch: kv.get("branch")?.replace(/^refs\/heads\//, "") ?? null,
      head: (kv.get("HEAD") ?? "").slice(0, 8),
      isMain: i === 0,
      bare: kv.has("bare"),
      locked: kv.has("locked"),
      prunable: kv.has("prunable"),
      dirty: null,
      processes: [],
    };
  });
}

export function countDirty(path: string): number | null {
  const out = run("git", ["status", "--porcelain"], path);
  return out === null ? null : lines(out).length;
}

export const currentBranch = (path: string) => run("git", ["branch", "--show-current"], path)?.trim() || undefined;
