import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { boardRows, wsCommandFor, parseList, toggleCollapsed, type BoardRow } from "../src/agent-board/board";

const agent = (p: { id: string; name: string; status: "working" | "idle"; needsResume: boolean; attached: boolean }) => ({
  id: p.id,
  name: p.name,
  status: p.status,
  needsResume: p.needsResume,
  alive: true,
  cwd: "/g/o/api=feat",
  missingLocation: false,
  parent: null,
  tmux: { attached: p.attached, panes: p.attached ? ["%1"] : [] },
});

const tree: ListedTree = {
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
            agent({ id: "t1", name: "api-feat", status: "working", needsResume: false, attached: true }),
            agent({ id: "t2", name: "api-feat-2", status: "idle", needsResume: true, attached: false }),
          ],
        },
      ],
    },
  ],
};

const find = (rows: BoardRow[], key: string) => rows.find((r) => r.key === key && r.kind === "agent")!;

describe("boardRows", () => {
  test("terminals() の即時の状態を重ね、注意が要る順に並べる", () => {
    const rows = boardRows(tree, [{ address: "t1", status: { state: "blocked", kind: "permission" } }], []);
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "worktree", "agent", "agent"]);
    expect(rows[0]).toMatchObject({ waiting: 2 });
    expect(rows[3]).toMatchObject({ key: "t1", status: "blocked(permission)", icon: "▲" });
    expect(rows[4]).toMatchObject({ key: "t2", canResume: true });
  });

  test("タグは tmux の popup と同じ部品（utils）で作る", () => {
    const rows = boardRows(tree, [], []);
    expect(rows[1]).toMatchObject({ tags: [{ text: "[main]" }, { text: "tmux*" }] });
    expect(find(rows, "t2")).toMatchObject({ tags: [{ text: "要再開", tone: "strong" }, { text: "未attach", tone: "muted" }] });
  });

  test("名乗っていない（status が null）なら ws list の状態のまま", () => {
    expect(find(boardRows(tree, [{ address: "t2", status: null }], []), "t2")).toMatchObject({ rawStatus: "idle" });
  });

  test("折り畳んだ workspace は中身を出さない", () => {
    const rows = boardRows(tree, [], ["/g/o/api"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ collapsed: true });
  });
});

describe("wsCommandFor", () => {
  const rows = boardRows(tree, [], []);
  const wt = rows[2]!;
  test("クリック → ws go <ref> --from-app", () => {
    expect(wsCommandFor(wt, "go")).toEqual(["ws", ["go", "/g/o/api=feat", "--from-app"]]);
    expect(wsCommandFor(find(rows, "t1"), "go")).toEqual(["ws", ["go", "t1", "--from-app"]]);
  });
  test("新規 → ws new <worktree> --attach --from-app", () => {
    expect(wsCommandFor(wt, "new")).toEqual(["ws", ["new", "/g/o/api=feat", "--attach", "--from-app"]]);
  });
  test("再開は要再開のときだけ", () => {
    expect(wsCommandFor(find(rows, "t2"), "resume")).toEqual(["ws", ["resume", "t2"]]);
    expect(wsCommandFor(find(rows, "t1"), "resume")).toBeNull();
  });
  test("workspace 行は何もしない", () => expect(wsCommandFor(rows[0]!, "go")).toBeNull());
});

describe("その他", () => {
  test("toggleCollapsed", () => {
    expect(toggleCollapsed([], "a")).toEqual(["a"]);
    expect(toggleCollapsed(["a"], "a")).toEqual([]);
  });
  test("parseList は壊れた出力でも空の木", () => {
    expect(parseList("oops")).toEqual({ workspaces: [] });
  });
});
