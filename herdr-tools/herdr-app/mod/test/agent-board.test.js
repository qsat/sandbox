// mod の純粋なロジックの検査。herdr / gpui-kit はモックに差し替える。
//   cd herdr-tools && bun test herdr-app
import { describe, expect, mock, test } from "bun:test";

mock.module("herdr", () => ({ terminals: () => [], exec: async () => ({ code: 0, stdout: "{}" }), shared: {}, setShared: () => {} }));
mock.module("gpui-kit", () => ({}));

const { boardRows, commandFor, toggleCollapsed, parseList } = await import("../agent-board/main.js");

const tree = {
  workspaces: [
    {
      path: "/g/o/api",
      name: "github.com/o/api",
      worktrees: [
        { path: "/g/o/api", branch: "main", exists: true, isMain: true, tmux: { session: { name: "api", attached: true } }, agents: [] },
        {
          path: "/g/o/api=feat",
          branch: "feat",
          exists: true,
          isMain: false,
          tmux: { session: null },
          agents: [
            { id: "t1", name: "api-feat", status: "working", needsResume: false, missingLocation: false, parent: null, tmux: { attached: true, panes: ["%1"] } },
            { id: "t2", name: "api-feat-2", status: "idle", needsResume: true, missingLocation: false, parent: null, tmux: { attached: false, panes: [] } },
          ],
        },
      ],
    },
  ],
};

describe("boardRows", () => {
  test("terminals() の即時の状態を重ね、注意が要る順に並べる", () => {
    const rows = boardRows(tree, [{ address: "t1", status: { state: "blocked", kind: "permission" } }], []);
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "worktree", "agent", "agent"]);
    expect(rows[0].waiting).toBe(2);
    expect(rows[3]).toMatchObject({ key: "t1", status: "blocked(permission)" });
    expect(rows[4]).toMatchObject({ key: "t2", canResume: true, tags: ["要再開", "未attach"] });
  });

  test("hc ls 形式（status が単語）でも重ねられる", () => {
    const rows = boardRows(tree, [{ address: "t2", status: "error" }], []);
    expect(rows.find((r) => r.key === "t2").rawStatus).toBe("error");
  });

  test("折り畳んだ workspace は中身を出さない", () => {
    const rows = boardRows(tree, [], ["/g/o/api"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].collapsed).toBe(true);
  });
});

describe("commandFor", () => {
  const rows = boardRows(tree, [], []);
  const wt = rows[2];
  const t2 = rows.find((r) => r.key === "t2");
  const t1 = rows.find((r) => r.key === "t1");
  test("クリック → ws go <ref> --from-app", () => {
    expect(commandFor(wt, "go")).toEqual(["ws", ["go", "/g/o/api=feat", "--from-app"]]);
    expect(commandFor(t1, "go")).toEqual(["ws", ["go", "t1", "--from-app"]]);
  });
  test("新規 → ws new <worktree> --attach --from-app", () => {
    expect(commandFor(wt, "new")).toEqual(["ws", ["new", "/g/o/api=feat", "--attach", "--from-app"]]);
  });
  test("再開は要再開のときだけ", () => {
    expect(commandFor(t2, "resume")).toEqual(["ws", ["resume", "t2"]]);
    expect(commandFor(t1, "resume")).toBeNull();
  });
  test("workspace 行は何もしない", () => expect(commandFor(rows[0], "go")).toBeNull());
});

describe("その他", () => {
  test("toggleCollapsed", () => {
    expect(toggleCollapsed([], "a")).toEqual(["a"]);
    expect(toggleCollapsed(["a"], "a")).toEqual([]);
  });
  test("parseList は壊れた出力でも空の木", () => {
    expect(parseList("oops")).toEqual({ workspaces: [] });
    expect(parseList('{"workspaces":[]}')).toEqual({ workspaces: [] });
  });
});
