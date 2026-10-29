import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { attempt } from "../../../lib/attempt.ts";
import { lines, realPath, run } from "../../../lib/run.ts";
import type { Worktree } from "../../types/workspace.ts";
import { repoName } from "../../utils/repoName.ts";
import { parseWorktrees } from "./parse.ts";

/** ghq のルートを決めるもの（環境変数 GHQ_ROOT とホーム。entry が渡す） */
export interface Ghq {
  root: string[]; // GHQ_ROOT
  home: string;
}

/** ghq のルート（ghq コマンド → GHQ_ROOT → git config ghq.root → ~/ghq） */
export function ghqRoots(ghq: Ghq): string[] {
  const roots = [
    lines(run("ghq", ["root", "--all"])),
    ghq.root,
    lines(run("git", ["config", "--get-all", "ghq.root"])).map((p) => p.replace(/^~/, ghq.home)),
  ].find((c) => c.length);
  return (roots ?? [join(ghq.home, "ghq")]).map(realPath);
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

export const listWorktrees = (repoPath: string): Worktree[] =>
  parseWorktrees(run("git", ["worktree", "list", "--porcelain"], repoPath) ?? "").map((w) => ({ ...w, path: realPath(w.path) }));

export function countDirty(path: string): number | null {
  const out = run("git", ["status", "--porcelain"], path);
  if (out === null) return null;
  return lines(out).length;
}

/** その場所のリポジトリ名（worktree ならメインの名前）と、いまのブランチ */
export function locate(cwd: string, ghq: Ghq): { repo: string; branch?: string } {
  const main = listWorktrees(cwd)[0]?.path;
  const branch = currentBranch(cwd);
  if (!main) return { repo: cwd, branch };
  return { repo: repoName(main, ghqRoots(ghq)), branch };
}

export const currentBranch = (path: string) => run("git", ["branch", "--show-current"], path)?.trim() || undefined;
