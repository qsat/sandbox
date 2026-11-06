import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "@herdr-tools/utils/expand-home";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { run } from "@herdr-tools/utils/run";
import { addChangeAmounts, BASE_REF_CANDIDATES, countTextLines, sumNumstat, UNTRACKED_MAX_BYTES, UNTRACKED_MAX_FILES, type ChangeAmount } from "./domain/change-amount";
import type { WorkspaceSource } from "./ports";

/** .git に何も書かずに読む引数（index の更新やロックを取らない） */
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export class GhqWorkspaceSource implements WorkspaceSource {
  private rootOnce?: Promise<string>;

  constructor(private readonly bins: { git?: string; ghq?: string; ghqRoot?: string } = {}) {}

  root() {
    return (this.rootOnce ??= this.findRoot());
  }

  private async findRoot() {
    if (this.bins.ghqRoot) return expandHome(this.bins.ghqRoot);
    const r = await run(this.bins.ghq ?? "ghq", ["root"]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0]! : join(homedir(), "ghq");
  }

  async entries(root: string) {
    const r = await run(this.bins.ghq ?? "ghq", ["list", "--full-path"]);
    if (r.code === 0) return r.stdout.split("\n").filter(Boolean);
    const subdirs = (paths: string[]) => paths.flatMap((p) => visibleDirs(p).map((name) => join(p, name)));
    const hosts = subdirs([root]);
    const owners = subdirs(hosts);
    return subdirs(owners);
  }

  inspect(paths: string[]) {
    return mapLimit(paths, 16, (p) => this.inspectOne(p));
  }

  async worktrees(repo: string) {
    const r = await run(this.bins.git ?? "git", ["-C", repo, "worktree", "list", "--porcelain"]);
    return r.code === 0 ? checkedOutWorktreePaths(r.stdout) : [];
  }

  /**
   * ベースブランチ（BASE_REF_CANDIDATES の最初に在るもの）から分かれた点を git merge-base で求め、
   * そこと作業ツリーの差を git diff --numstat で数える。追跡されていないファイルは行数を足した行に数える
   */
  async changeAmount(worktree: string): Promise<ChangeAmount | null> {
    const git = (args: string[]) => run(this.bins.git ?? "git", ["-C", worktree, ...READ, ...args]);
    let base: string | null = null;
    for (const ref of BASE_REF_CANDIDATES) {
      if ((await git(["rev-parse", "--verify", "--quiet", ref])).code === 0) {
        base = ref;
        break;
      }
    }
    if (!base) return null;
    const mergeBase = await git(["merge-base", base, "HEAD"]);
    const hash = mergeBase.stdout.trim();
    if (mergeBase.code !== 0 || !hash) return null;
    // ls-files は今いるディレクトリの下しか出さないので、worktree の一番上で読む（diff はどこからでも全体を出す）
    const root = (await git(["rev-parse", "--show-toplevel"])).stdout.trim() || worktree;
    const [diff, untracked] = await Promise.all([
      git(["diff", "--numstat", "-z", "--no-renames", hash]),
      run(this.bins.git ?? "git", ["-C", root, ...READ, "ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    if (diff.code !== 0) return null;
    const files = untracked.code === 0 ? untracked.stdout.split("\0").filter(Boolean) : [];
    const added = files.length > UNTRACKED_MAX_FILES ? 0 : files.reduce((sum, f) => sum + untrackedLines(join(root, f)), 0);
    return addChangeAmounts(sumNumstat(diff.stdout), { added, deleted: 0 });
  }

  private async inspectOne(path: string) {
    if (!isDir(path)) return { path, exists: false };
    const r = await run(this.bins.git ?? "git", ["-C", path, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    if (r.code !== 0) return { path, exists: true, toplevel: realpathSync(path) };
    const [toplevel = path, commonDir = "", branch = ""] = r.stdout.trim().split("\n");
    return { path, exists: true, toplevel, commonDir: commonDir || undefined, branch: branch && branch !== "HEAD" ? branch : null };
  }
}

function isDir(p: string) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function untrackedLines(path: string) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > UNTRACKED_MAX_BYTES) return 0;
    return countTextLines(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
}

function visibleDirs(p: string) {
  try {
    return readdirSync(p, { withFileTypes: true }).flatMap((d) => (d.isDirectory() && !d.name.startsWith(".") ? [d.name] : []));
  } catch {
    return [];
  }
}

export function checkedOutWorktreePaths(porcelain: string) {
  return porcelain
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => !lines.some((l) => l === "bare" || l.startsWith("prunable")))
    .flatMap((lines) => lines.filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)));
}
