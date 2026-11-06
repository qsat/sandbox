import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASE_REF_CANDIDATES } from "@herdr-tools/utils/base-ref-candidates";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { amountOfNumstat, countTextLines, UNTRACKED_MAX_BYTES, UNTRACKED_MAX_FILES, type ChangeAmount } from "./domain/change-amount";
import { GitCli } from "./git-cli";

export class GitChangeAmounts {
  constructor(private readonly git = new GitCli()) {}

  async of(worktrees: string[]): Promise<Record<string, ChangeAmount | null>> {
    const amounts = await mapLimit(worktrees, 8, (wt) => this.one(wt).catch(() => null));
    return Object.fromEntries(worktrees.map((wt, i) => [wt, amounts[i] ?? null]));
  }

  async one(worktree: string): Promise<ChangeAmount | null> {
    const base = await this.firstExistingRef(worktree);
    if (!base) return null;
    const mergeBase = await this.git.read(worktree, ["merge-base", base, "HEAD"]);
    const hash = mergeBase.stdout.trim();
    if (mergeBase.code !== 0 || !hash) return null;
    // ls-files は今いるディレクトリの下しか出さない
    const root = (await this.git.read(worktree, ["rev-parse", "--show-toplevel"])).stdout.trim() || worktree;
    const [diff, untracked] = await Promise.all([
      this.git.read(root, ["diff", "--numstat", "-z", "--no-renames", hash]),
      this.git.read(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    if (diff.code !== 0) return null;
    const files = untracked.code === 0 ? untracked.stdout.split("\0").filter(Boolean) : [];
    const added = files.length > UNTRACKED_MAX_FILES ? 0 : files.reduce((sum, f) => sum + untrackedLines(join(root, f)), 0);
    const tracked = amountOfNumstat(diff.stdout);
    return { added: tracked.added + added, deleted: tracked.deleted };
  }

  private async firstExistingRef(worktree: string) {
    for (const ref of BASE_REF_CANDIDATES) if ((await this.git.read(worktree, ["rev-parse", "--verify", "--quiet", ref])).code === 0) return ref;
    return null;
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
