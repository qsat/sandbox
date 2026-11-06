import { describe, expect, test } from "bun:test";
import { diffFilesArgs, rangeFiles, readLocalFiles, readRangeFiles, type FileChange } from "../src/shared/local-changes";
import { editBlockedReason, wsEditArgs } from "../src/shared/ws-edit";
import { changeRows, dirPaths, emptyMessage } from "../src/worktree-changes/rows";

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

describe("範囲（push 前・ベースから）", () => {
  test("差の引数は、分かれた点のハッシュと作業ツリーを -M で比べる", () => {
    expect(diffFilesArgs("abc", "name-status")).toEqual(["diff", "abc", "--name-status", "-z", "-M"]);
    expect(diffFilesArgs("abc", "numstat")).toEqual(["diff", "abc", "--numstat", "-z", "-M"]);
  });
  test("rangeFiles: name-status に numstat を合わせ、追跡していないファイルだけを status から足す", () => {
    const out = rangeFiles("M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0", "2\t1\ta.ts\0" + "0\t0\t\0old.ts\0new.ts\0" + "0\t5\tgone.ts\0", " M a.ts\0?? u.ts\0A  b.ts\0");
    expect(out).toEqual([
      { status: "M", path: "a.ts", add: 2, del: 1, binary: false },
      { status: "R", oldPath: "old.ts", path: "new.ts", add: 0, del: 0, binary: false },
      { status: "D", path: "gone.ts", add: 0, del: 5, binary: false },
      { status: "?", path: "u.ts", add: 0, del: 0, binary: false },
    ]);
  });
  test("readRangeFiles: merge-base を求めてから、そのハッシュで差を読む", async () => {
    const calls: string[][] = [];
    const out = await readRangeFiles(async (args) => {
      calls.push(args);
      if (args[0] === "merge-base") return { code: 0, stdout: "abc123\n" };
      if (args[0] === "status") return { code: 0, stdout: "?? n.ts\0" };
      return { code: 0, stdout: args.includes("--name-status") ? "A\0x.ts\0" : "4\t0\tx.ts\0" };
    }, "@{upstream}");
    expect(calls[0]).toEqual(["merge-base", "@{upstream}", "HEAD"]);
    expect(calls.slice(1).filter((c) => c[0] === "diff").every((c) => c[1] === "abc123")).toBe(true);
    expect(out?.map((f) => `${f.status}:${f.path}:${f.add}`)).toEqual(["A:x.ts:4", "?:n.ts:0"]);
  });
  test("readRangeFiles: 分かれた点が求まらなければ null（差は読まない）。差の読み取りが失敗したら空", async () => {
    const calls: string[][] = [];
    expect(await readRangeFiles(async (args) => (calls.push(args), { code: 128, stdout: "" }), "@{upstream}")).toBeNull();
    expect(calls.length).toBe(1);
    expect(await readRangeFiles(async (args) => (args[0] === "merge-base" ? { code: 0, stdout: "abc\n" } : { code: 1, stdout: "" }), "origin/main")).toEqual([]);
  });
  test("変更が 0 個のときの文言", () => {
    expect(emptyMessage("head", false, null)).toBe("No changes");
    expect(emptyMessage("unpushed", true, null)).toBe("No upstream branch");
    expect(emptyMessage("unpushed", false, null)).toBe("No unpushed changes");
    expect(emptyMessage("base", true, null)).toBe("No base branch");
    expect(emptyMessage("base", false, "main")).toBe("No changes since main");
  });
  test("削除されたファイル（D）は開かない", () => {
    expect(editBlockedReason({ status: "D", path: "a.ts" })).toBe("削除されたファイルは開けない: a.ts");
    expect(editBlockedReason({ status: "M", path: "a.ts" })).toBeNull();
  });
});
