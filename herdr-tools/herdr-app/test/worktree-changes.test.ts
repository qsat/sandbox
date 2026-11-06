import { describe, expect, test } from "bun:test";
import { readLocalFiles, type FileChange } from "../src/shared/local-changes";
import { wsEditArgs } from "../src/shared/ws-edit";
import { changeRows, dirPaths } from "../src/worktree-changes/rows";

const f = (path: string, status = "M", oldPath?: string): FileChange => ({ status, path, ...(oldPath ? { oldPath } : {}), add: 1, del: 0, binary: false });
const files = [f("src/b/z.ts"), f("README.md"), f("src/a.ts", "A"), f("src/b/y.ts", "?")];

describe("changeRows", () => {
  test("ツリー: フォルダー（名前順）が先、続けてファイル。下のファイルの数と深さを持つ", () => {
    const rows = changeRows(files, "tree", new Set());
    expect(rows.map((r) => `${r.kind}:${r.depth}:${r.kind === "dir" ? r.name : r.name}`)).toEqual([
      "dir:0:src",
      "dir:1:b",
      "file:2:y.ts",
      "file:2:z.ts",
      "file:1:a.ts",
      "file:0:README.md",
    ]);
    expect(rows[0]).toMatchObject({ id: "dir:src", open: true, count: 3 });
  });
  test("ツリー: 閉じているフォルダーの下は出さない", () => {
    const rows = changeRows(files, "tree", new Set(["src/b"]));
    expect(rows.map((r) => r.id)).toEqual(["dir:src", "dir:src/b", "file:src/a.ts", "file:README.md"]);
    expect(rows[1]).toMatchObject({ open: false, count: 2 });
  });
  test("フラット: パスの順にファイルだけ。名前の変更は旧 → 新", () => {
    const rows = changeRows([f("b.ts"), f("a/x.ts", "R", "a/w.ts")], "flat", new Set());
    expect(rows.map((r) => r.kind === "file" && r.name)).toEqual(["a/w.ts → a/x.ts", "b.ts"]);
  });
});

describe("readLocalFiles", () => {
  test("HEAD があれば git diff HEAD の numstat を status に合わせる", async () => {
    const calls: string[][] = [];
    const out = await readLocalFiles(async (args) => {
      calls.push(args);
      return args[0] === "status" ? { code: 0, stdout: " M a.ts\0?? b.ts\0" } : { code: 0, stdout: "3\t1\ta.ts\0" };
    }, true);
    expect(calls.map((c) => c[0] + " " + (c[1] ?? ""))).toEqual(["status --porcelain=v1", "diff HEAD"]);
    expect(out).toEqual([
      { status: "M", path: "a.ts", add: 3, del: 1, binary: false },
      { status: "?", path: "b.ts", add: 0, del: 0, binary: false },
    ]);
  });
  test("HEAD が無ければステージ済みと未ステージの numstat を足す。status が失敗したら空", async () => {
    const calls: string[][] = [];
    await readLocalFiles(async (args) => (calls.push(args), { code: 0, stdout: "" }), false);
    expect(calls.length).toBe(3);
    expect(await readLocalFiles(async () => ({ code: 128, stdout: "" }), true)).toEqual([]);
  });
});

test("ws edit の引数は worktree と相対パスと --from-app", () => {
  expect(wsEditArgs("/w/api", { path: "src/a.ts" })).toEqual(["edit", "/w/api", "--file", "src/a.ts", "--from-app"]);
});

describe("dirPaths", () => {
  test("ツリーに出るフォルダーのパスを、途中のフォルダーも含めて名前順にすべて返す", () =>
    expect(dirPaths([f("bin/check/tests/a.py"), f("bin/cli.py"), f("README.md"), f("work/x.toml")])).toEqual(["bin", "bin/check", "bin/check/tests", "work"]));
  test("「すべて閉じる」で全フォルダーを閉じると、最上位のフォルダーとファイルだけが並ぶ", () =>
    expect(changeRows([f("bin/check/a.py"), f("README.md")], "tree", new Set(dirPaths([f("bin/check/a.py")]))).map((r) => r.id)).toEqual(["dir:bin", "file:README.md"]));
});
