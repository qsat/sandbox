import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitChangeAmounts } from "../src/git-change-amounts";

describe("GitChangeAmounts（本物の git で確かめる）", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };

  test("main から分かれた点と作業ツリーの差を数える（コミット済み・未コミット・追跡されていないファイル）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-change-"));
    try {
      git(dir, "init", "-q", "-b", "main");
      writeFileSync(join(dir, "a.txt"), "1\n2\n3\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "base");
      git(dir, "switch", "-q", "-c", "feat");
      writeFileSync(join(dir, "a.txt"), "1\n2\nthree\n4\n");
      git(dir, "commit", "-q", "-am", "feat");
      // main に後から入ったコミットは数えない（分かれた点から比べる）
      git(dir, "switch", "-q", "main");
      writeFileSync(join(dir, "later.txt"), "later\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "later");
      git(dir, "switch", "-q", "feat");
      writeFileSync(join(dir, "a.txt"), "1\nthree\n4\n");
      writeFileSync(join(dir, "new.txt"), "x\ny");
      // a.txt: 3 行 → 「1, three, 4」で +2 −2（2 と 3 を消し、three と 4 を足す）。new.txt: +2
      expect(await new GitChangeAmounts().one(dir)).toEqual({ added: 4, deleted: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ベースブランチが無ければ null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-change-"));
    try {
      git(dir, "init", "-q", "-b", "trunk");
      writeFileSync(join(dir, "a.txt"), "1\n");
      git(dir, "add", ".");
      git(dir, "commit", "-q", "-m", "base");
      expect(await new GitChangeAmounts().one(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
