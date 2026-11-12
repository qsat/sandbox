import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worktrees } from "../src/worktrees";

/** 本物の git で、origin（bare）と本体の clone を用意して確かめる */
const ENV = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...ENV, ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}
function commit(cwd: string, file: string) {
  writeFileSync(join(cwd, file), `${file}\n`);
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", file);
}
const branches = (cwd: string) => git(cwd, "branch", "--format=%(refname:short)").trim().split("\n");

let dir = "";
let main = "";
const wt = (name: string) => join(dir, `api=${name}`);
const worktrees = new Worktrees();

beforeAll(() => {
  // macOS の tmpdir() は /var/...（/private/var へのシンボリックリンク）を返すが、git は実パスで答えるので、実パスにそろえる
  dir = realpathSync(mkdtempSync(join(tmpdir(), "ws-worktrees-")));
  const origin = join(dir, "origin.git");
  const pusher = join(dir, "pusher");
  main = join(dir, "api");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, pusher);
  commit(pusher, "a.txt");
  git(pusher, "push", "-q", "origin", "main");
  git(pusher, "switch", "-q", "-c", "feat/remote");
  commit(pusher, "remote.txt");
  git(pusher, "push", "-q", "origin", "feat/remote");
  git(dir, "clone", "-q", origin, main);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Worktrees.create（本物の git）", () => {
  test("新しいブランチは、呼んだ worktree の HEAD から分けて、本体の横に作る", async () => {
    expect(await worktrees.create(main, "feat/x")).toEqual({ path: wt("feat-x"), branch: "feat/x", base: { kind: "head" } });
    expect(git(wt("feat-x"), "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "HEAD"));
    commit(wt("feat-x"), "x.txt");
    // 本体ではなく feat/x の worktree から呼ぶと、feat/x の HEAD から分ける
    await worktrees.create(wt("feat-x"), "feat/x2");
    expect(existsSync(join(wt("feat-x2"), "x.txt"))).toBe(true);
  });

  test("--from のリビジョンから分ける", async () => {
    expect((await worktrees.create(wt("feat-x"), "from-main", { from: "main" })).base).toEqual({ kind: "from", rev: "main" });
    expect(existsSync(join(wt("from-main"), "x.txt"))).toBe(false);
  });

  test("origin に同じ名前のブランチがあれば、追跡して作る", async () => {
    expect((await worktrees.create(main, "feat/remote")).base).toEqual({ kind: "track-remote", remote: "origin/feat/remote" });
    expect(existsSync(join(wt("feat-remote"), "remote.txt"))).toBe(true);
    expect(git(wt("feat-remote"), "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("origin/feat/remote");
  });

  test("手元にあるブランチは、そのまま checkout する。--from とは両立しない", async () => {
    git(main, "branch", "local-only");
    await expect(worktrees.create(main, "local-only", { from: "main" })).rejects.toThrow("--from は指定できません");
    expect((await worktrees.create(main, "local-only")).base).toEqual({ kind: "existing-branch" });
  });

  test("そのブランチの worktree が既にあれば断る", async () => {
    await expect(worktrees.create(main, "feat/x")).rejects.toThrow(`既にあります: ${wt("feat-x")}`);
    await expect(worktrees.create(main, "main")).rejects.toThrow("既にあります");
  });

  test("扱えないブランチ名は断る", async () => {
    await expect(worktrees.create(main, "--force")).rejects.toThrow("扱えないブランチ名");
  });
});

describe("Worktrees.inspectForRemoval / remove（本物の git）", () => {
  test("未コミットの変更と追跡されていないファイルを数える", async () => {
    writeFileSync(join(wt("from-main"), "new.txt"), "new\n");
    writeFileSync(join(wt("from-main"), "a.txt"), "edited\n");
    const target = await worktrees.inspectForRemoval(wt("from-main"));
    expect(target).toEqual({ path: wt("from-main"), main, isMain: false, branch: "from-main", changes: [" M a.txt", "?? new.txt"], hasSubmodules: false });
  });

  test("worktree の中のフォルダーを渡しても、worktree の場所を答える。本体は isMain", async () => {
    expect((await worktrees.inspectForRemoval(main)).isMain).toBe(true);
    mkdirSync(join(wt("feat-x"), "sub"));
    expect((await worktrees.inspectForRemoval(join(wt("feat-x"), "sub"))).path).toBe(wt("feat-x"));
    rmSync(join(wt("feat-x"), "sub"), { recursive: true });
  });

  test("変更があると、--force なしの git は消さない。--force で消し、マージ済みのブランチも消す", async () => {
    const target = await worktrees.inspectForRemoval(wt("from-main"));
    await expect(worktrees.remove(target)).rejects.toThrow("worktree remove");
    expect(existsSync(wt("from-main"))).toBe(true);
    expect(await worktrees.remove(target, { force: true })).toEqual({ kind: "deleted", branch: "from-main" });
    expect(existsSync(wt("from-main"))).toBe(false);
    expect(branches(main)).not.toContain("from-main");
  });

  test("マージされていないブランチは残す", async () => {
    const target = await worktrees.inspectForRemoval(wt("feat-x2"));
    commit(wt("feat-x2"), "x2.txt");
    const r = await worktrees.remove(target);
    expect(r.kind).toBe("kept");
    expect(existsSync(wt("feat-x2"))).toBe(false);
    expect(branches(main)).toContain("feat/x2");
  });

  test("無い場所は断る", async () => {
    await expect(worktrees.inspectForRemoval(wt("feat-x2"))).rejects.toThrow("ディレクトリがありません");
  });
});
