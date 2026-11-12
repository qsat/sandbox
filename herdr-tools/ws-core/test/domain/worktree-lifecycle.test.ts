import { describe, expect, test } from "bun:test";
import { createBase, destroyRefusal, type RemovalTarget } from "../../src/domain/worktree-lifecycle";

describe("createBase（新しいブランチを分ける元）", () => {
  const input = { branch: "feat/x", localBranchExists: false, remoteBranchExists: false };

  test("手元にも origin にも無ければ HEAD から分ける", () => expect(createBase(input)).toEqual({ kind: "head" }));
  test("origin にあれば追跡する", () => expect(createBase({ ...input, remoteBranchExists: true })).toEqual({ kind: "track-remote", remote: "origin/feat/x" }));
  test("--from は origin のブランチより優先する", () => expect(createBase({ ...input, remoteBranchExists: true, from: "main" })).toEqual({ kind: "from", rev: "main" }));
  test("手元にあればそのまま使う", () => expect(createBase({ ...input, localBranchExists: true, remoteBranchExists: true })).toEqual({ kind: "existing-branch" }));
  test("手元にあるブランチに --from は指定できない", () => expect(() => createBase({ ...input, localBranchExists: true, from: "main" })).toThrow("--from は指定できません"));
  test("- で始まるリビジョンは断る", () => expect(() => createBase({ ...input, from: "--orphan" })).toThrow("扱えないリビジョン"));
});

describe("destroyRefusal（worktree を消すのを断る理由）", () => {
  const target: RemovalTarget = { path: "/g/o/api=feat-x", main: "/g/o/api", isMain: false, branch: "feat/x", changes: [], hasSubmodules: false };
  const refusal = (t: Partial<RemovalTarget>, opts: { force?: boolean; callerIsAgentHere?: boolean } = {}) =>
    destroyRefusal({ target: { ...target, ...t }, force: !!opts.force, callerIsAgentHere: !!opts.callerIsAgentHere });

  test("変更が無ければ断らない", () => expect(refusal({})).toBeNull());
  test("本体の worktree は --force でも断る", () => expect(refusal({ isMain: true }, { force: true })).toContain("本体の worktree"));
  test("呼び出したエージェント自身がいる worktree は --force でも断る", () => expect(refusal({}, { force: true, callerIsAgentHere: true })).toContain("エージェント自身"));
  test("未コミットの変更があれば断り、--force なら断らない", () => {
    expect(refusal({ changes: [" M a.txt", "?? new.txt"] })).toContain("2 個ある");
    expect(refusal({ changes: [" M a.txt"] }, { force: true })).toBeNull();
  });
  test("変更が 10 個を超えたら、残りは個数だけ出す", () => {
    const changes = Array.from({ length: 12 }, (_, i) => `?? f${i}.txt`);
    expect(refusal({ changes })).toContain("…ほか 2 個");
  });
  test("submodule があれば断り、--force なら断らない", () => {
    expect(refusal({ hasSubmodules: true })).toContain("submodule");
    expect(refusal({ hasSubmodules: true }, { force: true })).toBeNull();
  });
});
