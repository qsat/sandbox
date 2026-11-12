import { existsSync } from "node:fs";
import { join } from "node:path";
import { isSafeBranchName, prWorktreePath, worktreeOfBranch } from "./domain/pr-worktree";
import { mainRepositoryOf } from "./domain/tree";
import { createBase, type BranchRemoval, type CreatedWorktree, type RemovalTarget } from "./domain/worktree-lifecycle";
import { GitCli } from "./git-cli";

/**
 * worktree を作る・消す（ws create / ws destroy の git の部分）。
 * 判断の規則は domain/worktree-lifecycle.ts にあり、ここは git を呼ぶだけ。エージェントとクライアントのセッションは扱わない
 */
export class Worktrees {
  private readonly git: GitCli;

  constructor(bins: { git?: string } = {}) {
    this.git = new GitCli(bins.git);
  }

  private async mainOf(repo: string) {
    return mainRepositoryOf((await this.git.ok(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  }

  private async refExists(repo: string, ref: string) {
    return (await this.git.run(repo, ["rev-parse", "--verify", "--quiet", ref])).code === 0;
  }

  /**
   * repo（そのリポジトリのどれかの worktree）で、branch の worktree を本体の横に作る（置き場所は ws pr と同じ「本体のフォルダー名=ブランチ名」）。
   * そのブランチの worktree が既にあれば断る。新しいブランチは、from、origin の同じ名前のブランチ、repo の HEAD の順で分ける元を決める
   */
  async create(repo: string, branch: string, opts: { from?: string } = {}): Promise<CreatedWorktree> {
    if (!isSafeBranchName(branch)) throw new Error(`扱えないブランチ名です: ${branch}`);
    const main = await this.mainOf(repo);
    const existing = worktreeOfBranch(await this.git.ok(main, ["worktree", "list", "--porcelain"]), branch);
    if (existing) throw new Error(`ブランチ ${branch} の worktree は既にあります: ${existing}（エージェントの起動は ws new ${existing}）`);
    const path = prWorktreePath(main, branch);
    if (existsSync(path)) throw new Error(`作る場所に既にファイルかフォルダーがあります: ${path}`);

    const [localBranchExists, remoteBranchExists] = await Promise.all([this.refExists(main, `refs/heads/${branch}`), this.refExists(main, `refs/remotes/origin/${branch}`)]);
    const base = createBase({ branch, localBranchExists, remoteBranchExists, from: opts.from });
    // HEAD から分けるときは、呼んだ worktree（repo）の HEAD を使うので、repo で実行する
    switch (base.kind) {
      case "existing-branch":
        await this.git.ok(main, ["worktree", "add", "--quiet", path, branch]);
        break;
      case "track-remote":
        await this.git.ok(main, ["worktree", "add", "--quiet", "--track", "-b", branch, path, base.remote]);
        break;
      case "from":
        await this.git.ok(repo, ["worktree", "add", "--quiet", "--no-track", "-b", branch, path, base.rev]);
        break;
      case "head":
        await this.git.ok(repo, ["worktree", "add", "--quiet", "-b", branch, path, "HEAD"]);
        break;
    }
    return { path, branch, base };
  }

  /** 消す前に、worktree の場所・ブランチ・未コミットの変更を調べる。git の worktree でなければ失敗する */
  async inspectForRemoval(path: string): Promise<RemovalTarget> {
    if (!existsSync(path)) throw new Error(`ディレクトリがありません: ${path}（場所が消えた worktree の片付けは ws prune）`);
    const out = await this.git.ok(path, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    const [toplevel = path, commonDir = "", branch = ""] = out.trim().split("\n");
    const main = mainRepositoryOf(commonDir);
    const status = await this.git.ok(toplevel, ["status", "--porcelain", "--untracked-files=all"]);
    return {
      path: toplevel,
      main,
      isMain: toplevel === main,
      branch: branch && branch !== "HEAD" ? branch : null,
      changes: status.split("\n").filter(Boolean),
      hasSubmodules: existsSync(join(toplevel, ".gitmodules")),
    };
  }

  /**
   * worktree を消し、消えたことを確かめてから、ブランチを git branch -d で消す。
   * -d は、マージされていないブランチを消さない（そのときはブランチを残して理由を返す）
   */
  async remove(target: RemovalTarget, opts: { force?: boolean } = {}): Promise<BranchRemoval> {
    await this.git.ok(target.main, ["worktree", "remove", ...(opts.force ? ["--force"] : []), target.path]);
    if (existsSync(target.path)) throw new Error(`git worktree remove は成功しましたが、フォルダーが残っています: ${target.path}`);
    if (!target.branch) return { kind: "none" };
    const r = await this.git.run(target.main, ["branch", "-d", target.branch]);
    return r.code === 0 ? { kind: "deleted", branch: target.branch } : { kind: "kept", branch: target.branch, reason: r.stderr.trim().split("\n")[0] || `exit ${r.code}` };
  }
}
