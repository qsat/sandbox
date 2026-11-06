import { describe, expect, test } from "bun:test";
import { checkedOutWorktreePaths } from "../src/ghq-workspace-source";

describe("checkedOutWorktreePaths", () => {
  test("git worktree list --porcelain から、作業ツリーのある worktree の場所だけを取り出す", () => {
    const porcelain = [
      "worktree /g/o/api\nHEAD aaa\nbranch refs/heads/main",
      "worktree /g/o/api=feat\nHEAD bbb\nbranch refs/heads/feat",
      "worktree /g/o/api=detached\nHEAD ccc\ndetached",
      "worktree /g/o/api=gone\nHEAD ddd\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location",
      "",
    ].join("\n\n");
    expect(checkedOutWorktreePaths(porcelain)).toEqual(["/g/o/api", "/g/o/api=feat", "/g/o/api=detached"]);
  });

  test("bare リポジトリの本体は並べない", () => {
    expect(checkedOutWorktreePaths("worktree /g/o/bare.git\nbare\n\nworktree /g/o/bare=main\nHEAD aaa\nbranch refs/heads/main\n")).toEqual(["/g/o/bare=main"]);
  });
});
