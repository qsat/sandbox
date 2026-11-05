import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { LOG_ARGS, branchLabel, commitFiles, localFiles, logArgs, prBaseRef, parseDecorations, parseLog, parseNameStatus, parseNumstat, parseStatus, relativeTime, shortRef, sumNumstat, wsHunkArgs } from "../src/commit-history/git";

describe("一覧に出すコミットの範囲", () => {
  test("すべては HEAD からの履歴", () => expect(logArgs("all")).toEqual(LOG_ARGS));
  test("push 前は上流のブランチから HEAD まで", () => expect(logArgs("unpushed")).toEqual([...LOG_ARGS, "@{upstream}..HEAD"]));
  test("ベースからはベースブランチから HEAD まで。ベースブランチが分からなければ git を呼ばない", () => {
    expect(logArgs("base", "origin/main")).toEqual([...LOG_ARGS, "origin/main..HEAD"]);
    expect(logArgs("base", null)).toBeNull();
  });
  test("ref の名前から refs/remotes/ と refs/heads/ を外す", () => {
    expect(shortRef("refs/remotes/origin/main\n")).toBe("origin/main");
    expect(shortRef("refs/heads/master")).toBe("master");
  });
  test("ボタンにはブランチ名だけを出す（origin/ を外す）", () => {
    expect(branchLabel("origin/main")).toBe("main");
    expect(branchLabel("develop")).toBe("develop");
  });
  test("プルリクエストの base ブランチは、リモートのブランチを先に、無ければ手元のブランチを使う", () => {
    expect(prBaseRef("develop\n", (r) => r === "refs/remotes/origin/develop" || r === "refs/heads/develop")).toBe("origin/develop");
    expect(prBaseRef("develop", (r) => r === "refs/heads/develop")).toBe("develop");
    expect(prBaseRef("develop", () => false)).toBeNull();
    expect(prBaseRef("", () => true)).toBeNull();
  });
});
import { LOCAL_ID, moveSelection, visibleRows } from "../src/commit-history/rows";
import { resolveTarget, type Target } from "../src/commit-history/target";

const wt = (path: string, branch: string | null, panesCurrent: boolean, agentCurrent: boolean) => ({
  path,
  branch,
  exists: true,
  isMain: false,
  tmux: { session: null, panes: [{ paneId: "%1", command: "zsh", current: panesCurrent }] },
  agents: [
    {
      id: "a1",
      name: "a1",
      status: "idle" as const,
      alive: true,
      cwd: path,
      missingLocation: false,
      parent: null,
      resumable: false,
      tmux: { attached: true, panes: ["%2"], current: agentCurrent },
    },
  ],
});

const list = (...worktrees: ReturnType<typeof wt>[]) => ({ usage: {}, workspaces: [{ path: "/g/o/api", name: "github.com/o/api", worktrees }] }) as unknown as ListedTree;
const previous: Target = { path: "/g/o/old", workspace: "github.com/o/old", label: "old", branch: "old" };

describe("今いるペインの worktree を決める", () => {
  test("worktree 直下のペインが今いるペインなら、その worktree", () => {
    const t = resolveTarget(list(wt("/g/o/api", "main", false, false), wt("/g/o/api=feat", "feat", true, false)), previous);
    expect(t).toEqual({ path: "/g/o/api=feat", workspace: "github.com/o/api", label: "feat", branch: "feat" });
  });
  test("会話ペインが今いるペインなら、そのエージェントの worktree", () => {
    expect(resolveTarget(list(wt("/g/o/api", "main", false, true)), null)?.path).toBe("/g/o/api");
  });
  test("ブランチが無い worktree の表示名はフォルダー名", () => {
    expect(resolveTarget(list(wt("/g/o/api=x", null, true, false)), null)).toMatchObject({ label: "api=x", branch: null });
  });
  test("どの worktree にも今いるペインが無ければ、前の値のまま", () => {
    expect(resolveTarget(list(wt("/g/o/api", "main", false, false)), previous)).toBe(previous);
  });
  test("一度も決まっていなければ null", () => {
    expect(resolveTarget(list(wt("/g/o/api", "main", false, false)), null)).toBeNull();
  });
});

describe("git log の読み取り", () => {
  const rec = (hash: string, refs: string, subject: string) => `\x1e${hash}\x1f${hash.slice(0, 7)}\x1fAlice\x1f1700000000\x1f${refs}\x1f${subject}\n`;
  test("区切り文字で分け、%D が空なら refs は空", () => {
    const commits = parseLog(rec("aaaaaaaaaaaa", "HEAD -> main, origin/main, tag: v1", "件名 1") + rec("bbbbbbbbbbbb", "", "件名 2"));
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({ hash: "aaaaaaaaaaaa", short: "aaaaaaa", author: "Alice", time: 1700000000, refs: ["HEAD -> main", "origin/main", "tag: v1"], subject: "件名 1" });
    expect(commits[1]).toMatchObject({ refs: [], subject: "件名 2" });
  });
  test("出力が空なら 0 件", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseDecorations("")).toEqual([]);
  });
  test("相対的な日時", () => {
    expect(relativeTime(1000, 990)).toBe("たった今");
    expect(relativeTime(10000, 10000 - 3 * 3600)).toBe("3 時間前");
    expect(relativeTime(10_000_000, 10_000_000 - 2 * 86400)).toBe("2 日前");
  });
});

describe("git show の numstat / name-status の読み取り", () => {
  const numstat = "3\t1\ta.ts\0-\t-\timg.png\0" + "0\t0\t\0old.ts\0new.ts\0";
  const nameStatus = "M\0a.ts\0A\0img.png\0D\0gone.ts\0R100\0old.ts\0new.ts\0";
  test("numstat は追加・削除・名前の変更・バイナリ（行数が -）を読む", () => {
    expect(parseNumstat(numstat)).toEqual([
      { path: "a.ts", add: 3, del: 1, binary: false },
      { path: "img.png", add: 0, del: 0, binary: true },
      { path: "new.ts", oldPath: "old.ts", add: 0, del: 0, binary: false },
    ]);
  });
  test("name-status は種類とパス（名前の変更は旧パスも）を読む", () => {
    expect(parseNameStatus(nameStatus)).toEqual([
      { status: "M", path: "a.ts" },
      { status: "A", path: "img.png" },
      { status: "D", path: "gone.ts" },
      { status: "R", path: "new.ts", oldPath: "old.ts" },
    ]);
  });
  test("2 つを path で合わせる。numstat に無い削除は 0 行", () => {
    const files = commitFiles(nameStatus, numstat);
    expect(files.map((f) => [f.status, f.path, f.add, f.del, f.binary])).toEqual([
      ["M", "a.ts", 3, 1, false],
      ["A", "img.png", 0, 0, true],
      ["D", "gone.ts", 0, 0, false],
      ["R", "new.ts", 0, 0, false],
    ]);
  });
  test("タブを含むパスも読める", () => {
    expect(parseNumstat("1\t2\ta\tb.ts\0")).toEqual([{ path: "a\tb.ts", add: 1, del: 2, binary: false }]);
  });
});

describe("git status --porcelain -z の読み取り", () => {
  test("変更・追加・削除・追跡されていないファイル・名前の変更（新 → 旧の順）", () => {
    expect(parseStatus(" M a.ts\0A  b.ts\0 D c.ts\0?? d.ts\0R  new.ts\0old.ts\0UU e.ts\0")).toEqual([
      { status: "M", path: "a.ts" },
      { status: "A", path: "b.ts" },
      { status: "D", path: "c.ts" },
      { status: "?", path: "d.ts" },
      { status: "R", path: "new.ts", oldPath: "old.ts" },
      { status: "U", path: "e.ts" },
    ]);
  });
  test("空なら 0 件", () => {
    expect(parseStatus("")).toEqual([]);
  });
  test("行数は diff の numstat から path で合わせる（HEAD が無いときは 2 つを足す）。追跡されていないファイルは 0", () => {
    const stats = sumNumstat("2\t0\ta.ts\0", "1\t1\ta.ts\0");
    expect(localFiles(" M a.ts\0?? d.ts\0", stats).map((f) => [f.path, f.add, f.del])).toEqual([
      ["a.ts", 3, 1],
      ["d.ts", 0, 0],
    ]);
  });
});

describe("行の並びと選択", () => {
  const commit = (hash: string) => ({ hash, short: hash.slice(0, 7), author: "A", time: 0, refs: [], subject: hash });
  const file = { status: "M", path: "x.ts", add: 1, del: 0, binary: false };
  test("未コミットの変更が先頭。変更が無ければ出さない", () => {
    expect(visibleRows([commit("c1")], [file], null, new Map()).map((r) => r.id)).toEqual([LOCAL_ID, "commit:c1"]);
    expect(visibleRows([commit("c1")], [], null, new Map()).map((r) => r.id)).toEqual(["commit:c1"]);
  });
  test("開いた行の下にファイルが並ぶ", () => {
    expect(visibleRows([commit("c1"), commit("c2")], [], "c1", new Map([["c1", [file]]])).map((r) => r.id)).toEqual(["commit:c1", "file:c1:x.ts", "commit:c2"]);
  });
  test("j / k の移動は端で止まる", () => {
    const rows = visibleRows([commit("c1"), commit("c2")], [], null, new Map());
    expect(moveSelection(rows, null, 1)).toBe("commit:c1");
    expect(moveSelection(rows, "commit:c1", 1)).toBe("commit:c2");
    expect(moveSelection(rows, "commit:c2", 1)).toBe("commit:c2");
    expect(moveSelection(rows, "commit:c1", -1)).toBe("commit:c1");
  });
});

describe("ws hunk へ渡す引数", () => {
  test("コミットの下のファイルは --commit、未コミットは付けない", () => {
    expect(wsHunkArgs("/r", "abc", { path: "a.ts" })).toEqual(["hunk", "/r", "--commit", "abc", "--file", "a.ts", "--from-app"]);
    expect(wsHunkArgs("/r", null, { path: "a.ts" })).toEqual(["hunk", "/r", "--file", "a.ts", "--from-app"]);
  });
  test("コミットのハッシュから開くときはファイルを指定せず、コミット全体を開く", () => {
    expect(wsHunkArgs("/r", "abc", null)).toEqual(["hunk", "/r", "--commit", "abc", "--from-app"]);
  });
});
