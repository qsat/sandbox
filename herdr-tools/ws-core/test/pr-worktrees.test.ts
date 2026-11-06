import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrWorktrees } from "../src/pr-worktrees";

/** 本物の git で、origin（bare）・本体の clone・偽の gh を用意して確かめる */
const ENV = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...ENV, ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}

let dir = "";
let origin = "";
let main = "";
let pusher = "";
let gh = "";

function fakeGh(json: object) {
  writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(json)}\nJSON\n`);
  chmodSync(gh, 0o755);
}

/** 別の clone から origin の feat/x にコミットを push する（ほかの人がプルリクエストを進めた） */
function pushToOrigin(file: string) {
  writeFileSync(join(pusher, file), `${file}\n`);
  git(pusher, "add", ".");
  git(pusher, "commit", "-q", "-m", file);
  git(pusher, "push", "-q", "origin", "feat/x");
}

beforeAll(() => {
  // macOS の tmpdir() は /var/...（/private/var へのシンボリックリンク）を返すが、git は実パスで答えるので、実パスにそろえる
  dir = realpathSync(mkdtempSync(join(tmpdir(), "ws-pr-")));
  origin = join(dir, "origin.git");
  main = join(dir, "api");
  pusher = join(dir, "pusher");
  gh = join(dir, "gh");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, pusher);
  writeFileSync(join(pusher, "a.txt"), "a\n");
  git(pusher, "add", ".");
  git(pusher, "commit", "-q", "-m", "init");
  git(pusher, "push", "-q", "origin", "main");
  git(pusher, "switch", "-q", "-c", "feat/x");
  pushToOrigin("b.txt");
  git(dir, "clone", "-q", origin, main);
  fakeGh({ number: 7, headRefName: "feat/x", isCrossRepository: false });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("PrWorktrees.prepare（本物の git）", () => {
  const prs = () => new PrWorktrees({ gh });
  const wt = () => join(dir, "api=feat-x");

  test("worktree が無ければ、本体の横に origin のブランチを追跡して作る", async () => {
    expect(await prs().prepare(main, 7)).toEqual({ kind: "created", path: wt(), branch: "feat/x" });
    expect(existsSync(join(wt(), "b.txt"))).toBe(true);
    expect(git(wt(), "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("origin/feat/x");
  });

  test("あれば最新にする。進んでいなければ最新のまま", async () => {
    pushToOrigin("c.txt");
    expect(await prs().prepare(wt(), 7)).toEqual({ kind: "updated", path: wt(), commits: 1 });
    expect(existsSync(join(wt(), "c.txt"))).toBe(true);
    expect(await prs().prepare(main, 7)).toEqual({ kind: "up-to-date", path: wt() });
  });

  test("未コミットの変更があれば更新しない", async () => {
    pushToOrigin("d.txt");
    writeFileSync(join(wt(), "b.txt"), "edited\n");
    expect(await prs().prepare(main, 7)).toEqual({ kind: "skip-dirty", path: wt() });
    expect(existsSync(join(wt(), "d.txt"))).toBe(false);
    git(wt(), "checkout", "-q", "--", "b.txt");
  });

  test("push 前のコミットがあれば更新しない", async () => {
    writeFileSync(join(wt(), "mine.txt"), "mine\n");
    git(wt(), "add", ".");
    git(wt(), "commit", "-q", "-m", "mine");
    expect(await prs().prepare(main, 7)).toEqual({ kind: "skip-ahead", path: wt(), commits: 1 });
  });

  test("フォークからのプルリクエストは断る", async () => {
    fakeGh({ number: 8, headRefName: "feat/y", isCrossRepository: true });
    await expect(prs().prepare(main, 8)).rejects.toThrow("フォーク");
    fakeGh({ number: 7, headRefName: "feat/x", isCrossRepository: false });
  });
});
