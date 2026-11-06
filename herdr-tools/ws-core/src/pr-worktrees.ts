import { existsSync } from "node:fs";
import { run } from "@herdr-tools/utils/run";
import { isSafeBranchName, parseAheadBehind, parsePrBranch, prWorktreePath, updateDecision, worktreeOfBranch, type PrWorktreeOutcome } from "./domain/pr-worktree";
import { mainRepositoryOf } from "./domain/tree";

/**
 * プルリクエストのブランチの worktree を用意する（gh でブランチを調べ、git で作る・最新にする）。
 * 判断の規則は domain/pr-worktree.ts にあり、ここは git と gh を呼ぶだけ
 */
export class PrWorktrees {
  constructor(private readonly bins: { git?: string; gh?: string } = {}) {}

  private git(cwd: string, args: string[]) {
    return run(this.bins.git ?? "git", ["-C", cwd, ...args]);
  }

  private async gitOk(cwd: string, args: string[]) {
    const r = await this.git(cwd, args);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout;
  }

  /**
   * repo（そのリポジトリのどれかの worktree）で、プルリクエスト number のブランチの worktree を用意する。
   * - origin からブランチを取ってくる（refs/remotes/origin/<ブランチ> を更新する）
   * - そのブランチの worktree が無ければ、本体の横に作る（手元にブランチがあればそれを、無ければ origin のブランチを追跡して作る）
   * - あれば、早送りできるときだけ最新にする（未コミットの変更・push 前のコミットがあれば触らない）
   * フォークからのプルリクエストは断る
   */
  async prepare(repo: string, number: number): Promise<PrWorktreeOutcome> {
    const view = await run(this.bins.gh ?? "gh", ["pr", "view", String(number), "--json", "number,headRefName,isCrossRepository"], { cwd: repo });
    if (view.code !== 0) throw new Error(`gh pr view ${number}: ${view.stderr.trim() || `exit ${view.code}`}`);
    const pr = parsePrBranch(view.stdout);
    if (!pr) throw new Error(`gh pr view ${number} の出力を読めません`);
    if (pr.crossRepository) throw new Error(`#${number} はフォークからのプルリクエストなので、まだ扱えません`);
    if (!isSafeBranchName(pr.head)) throw new Error(`扱えないブランチ名です: ${pr.head}`);

    const commonDir = (await this.gitOk(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    const main = mainRepositoryOf(commonDir);
    const remote = `refs/remotes/origin/${pr.head}`;
    await this.gitOk(main, ["fetch", "--quiet", "origin", `+refs/heads/${pr.head}:${remote}`]);

    const existing = worktreeOfBranch(await this.gitOk(main, ["worktree", "list", "--porcelain"]), pr.head);
    if (existing) return this.update(existing, remote);

    const path = prWorktreePath(main, pr.head);
    if (existsSync(path)) throw new Error(`作る場所に既にファイルかフォルダーがあります: ${path}`);
    const localBranch = (await this.git(main, ["rev-parse", "--verify", "--quiet", `refs/heads/${pr.head}`])).code === 0;
    if (localBranch) {
      await this.gitOk(main, ["worktree", "add", "--quiet", path, pr.head]);
      const updated = await this.update(path, remote);
      // 手元のブランチで作ったうえで、早送りできなかった・必要なかったときも「作った」と伝える（更新しなかった理由は別に出す）
      return updated.kind === "updated" || updated.kind === "up-to-date" ? { kind: "created", path, branch: pr.head } : updated;
    }
    await this.gitOk(main, ["worktree", "add", "--quiet", "--track", "-b", pr.head, path, remote]);
    return { kind: "created", path, branch: pr.head };
  }

  private async update(path: string, remote: string): Promise<PrWorktreeOutcome> {
    const [status, counts] = await Promise.all([
      this.gitOk(path, ["status", "--porcelain", "--untracked-files=no"]),
      this.gitOk(path, ["rev-list", "--left-right", "--count", `HEAD...${remote}`]),
    ]);
    const { ahead, behind } = parseAheadBehind(counts);
    switch (updateDecision({ dirty: status.trim() !== "", ahead, behind })) {
      case "skip-ahead":
        return { kind: "skip-ahead", path, commits: ahead };
      case "skip-dirty":
        return { kind: "skip-dirty", path };
      case "up-to-date":
        return { kind: "up-to-date", path };
      case "fast-forward":
        await this.gitOk(path, ["merge", "--ff-only", "--quiet", remote]);
        return { kind: "updated", path, commits: behind };
    }
  }
}
