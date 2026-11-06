import { describe, expect, test } from "bun:test";
import { isSafeBranchName, parseAheadBehind, parsePrBranch, prWorktreeMessage, prWorktreePath, updateDecision, worktreeOfBranch } from "../../src/domain/pr-worktree";

describe("プルリクエストの worktree の判断", () => {
  test("gh pr view の出力を読む", () => {
    expect(parsePrBranch(JSON.stringify({ number: 5, headRefName: "feat/x", isCrossRepository: false }))).toEqual({ number: 5, head: "feat/x", crossRepository: false });
    expect(parsePrBranch(JSON.stringify({ number: 5, headRefName: "x", isCrossRepository: true }))?.crossRepository).toBe(true);
    expect(parsePrBranch("oops")).toBeNull();
    expect(parsePrBranch(JSON.stringify({ number: 5, headRefName: "" }))).toBeNull();
  });
  test("作る場所は本体の横の「本体=ブランチ名」で、/ は - にする", () => {
    expect(prWorktreePath("/g/o/api", "feat/auth")).toBe("/g/o/api=feat-auth");
    expect(prWorktreePath("/g/o/api/", "fix")).toBe("/g/o/api=fix");
  });
  test("git の引数として安全なブランチ名だけ受け付ける", () => {
    for (const ok of ["feat/x", "fix-1", "release/1.2", "a_b+c"]) expect(isSafeBranchName(ok)).toBe(true);
    for (const bad of ["-x", "a..b", "a b", "x.lock", "x/", "", "a;rm"]) expect(isSafeBranchName(bad)).toBe(false);
  });
  test("そのブランチを checkout している worktree を探す（prunable は除く）", () => {
    const porcelain = [
      "worktree /g/o/api\nHEAD a\nbranch refs/heads/main",
      "worktree /g/o/api=feat-x\nHEAD b\nbranch refs/heads/feat/x",
      "worktree /g/o/api=gone\nHEAD c\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location",
      "",
    ].join("\n\n");
    expect(worktreeOfBranch(porcelain, "feat/x")).toBe("/g/o/api=feat-x");
    expect(worktreeOfBranch(porcelain, "feat")).toBeNull();
    expect(worktreeOfBranch(porcelain, "gone")).toBeNull();
  });
  test("早送りできるときだけ進め、push 前のコミット・未コミットの変更があれば触らない", () => {
    expect(updateDecision({ dirty: false, ahead: 0, behind: 2 })).toBe("fast-forward");
    expect(updateDecision({ dirty: false, ahead: 0, behind: 0 })).toBe("up-to-date");
    expect(updateDecision({ dirty: true, ahead: 0, behind: 0 })).toBe("up-to-date");
    expect(updateDecision({ dirty: true, ahead: 0, behind: 1 })).toBe("skip-dirty");
    expect(updateDecision({ dirty: false, ahead: 1, behind: 1 })).toBe("skip-ahead");
  });
  test("ahead と behind を読み、結果の文を作る", () => {
    expect(parseAheadBehind("1\t3\n")).toEqual({ ahead: 1, behind: 3 });
    expect(prWorktreeMessage({ kind: "updated", path: "/w", commits: 3 })).toBe("最新にしました（3 コミット進めた）: /w");
  });
});
