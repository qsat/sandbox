import { expect, test } from "bun:test";
import { parseWorktrees } from "../parse.ts";

// git 2.x の `git worktree list --porcelain` の出力（メイン・detached でロック・ブランチ・消えたもの）
const PORCELAIN = `worktree /w/api
HEAD de743d32cabb91a82232f667007927330c7a802b
branch refs/heads/main

worktree /w/api det
HEAD de743d32cabb91a82232f667007927330c7a802b
detached
locked

worktree /w/api-feat
HEAD 0123456789abcdef0123456789abcdef01234567
branch refs/heads/feat/x

worktree /w/gone
HEAD 0123456789abcdef0123456789abcdef01234567
branch refs/heads/old
prunable gitdir file points to non-existent location
`;

test("worktree: 先頭がメイン。ブランチは refs/heads/ を除き、HEAD は8桁。空白を含むパスもそのまま", () => {
  const [main, det, feat, gone] = parseWorktrees(PORCELAIN);
  expect(main).toMatchObject({ path: "/w/api", branch: "main", head: "de743d32", isMain: true, bare: false, locked: false });
  expect(det).toMatchObject({ path: "/w/api det", branch: null, isMain: false, locked: true });
  expect(feat).toMatchObject({ path: "/w/api-feat", branch: "feat/x", head: "01234567" });
  expect(gone).toMatchObject({ path: "/w/gone", prunable: true });
});

test("worktree: bare のメイン。出力が空なら無し", () => {
  expect(parseWorktrees("worktree /w/bare.git\nbare\n")).toMatchObject([{ path: "/w/bare.git", bare: true, branch: null }]);
  expect(parseWorktrees("")).toEqual([]);
});
