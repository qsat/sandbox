import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { boardRows, keyActionFor, moveSelection, rowId, wsCommandFor, wsArgsForModCommand, parseList, toggleCollapsed, type BoardRow } from "../src/agent-board/board";

const agent = (p: { id: string; name: string; status: "working" | "idle"; resumable: boolean; attached: boolean; current?: boolean; contextUsedPercentage?: number }) => ({
  contextUsedPercentage: p.contextUsedPercentage,
  id: p.id,
  name: p.name,
  status: p.status,
  resumable: p.resumable,
  alive: true,
  cwd: "/g/o/api=feat",
  missingLocation: false,
  parent: null,
  tmux: { attached: p.attached, panes: p.attached ? ["%1"] : [], current: p.current ?? false },
});

const tree: ListedTree = {
  usage: {},
  workspaces: [
    {
      path: "/g/o/api",
      name: "github.com/o/api",
      worktrees: [
        { path: "/g/o/api", branch: "main", exists: true, isMain: true, tmux: { session: { name: "api", attached: true }, panes: [] }, agents: [] },
        {
          path: "/g/o/api=feat",
          branch: "feat",
          exists: true,
          isMain: false,
          tmux: { session: null, panes: [] },
          agents: [
            agent({ id: "t1", name: "api-feat", status: "working", resumable: false, attached: true, contextUsedPercentage: 75 }),
            agent({ id: "t2", name: "api-feat-2", status: "idle", resumable: true, attached: false }),
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
    expect(rows[3]).toMatchObject({ key: "t1", status: "blocked(permission)", icon: "▲" });
    expect(rows[4]).toMatchObject({ key: "t2", canResume: true });
  });

  test("「待ち」は blocked だけを数える（再開できるだけのものは数えない）", () => {
    expect(boardRows(tree, [{ address: "t1", status: { state: "blocked" } }], [])[0]).toMatchObject({ waiting: 1 });
    expect(boardRows(tree, [], [])[0]).toMatchObject({ waiting: 0 });
  });

  test("タグは tmux の popup と同じ部品（utils）で作り、「要再開」は出さない（再開ボタンで示す）", () => {
    const rows = boardRows(tree, [], []);
    expect(rows[1]).toMatchObject({ tags: [{ text: "tmux*" }] });
    expect(find(rows, "t2")).toMatchObject({ tags: [{ text: "未attach", tone: "muted" }] });
  });

  test("worktree の行はブランチ名を名前にし、ブランチのタグは重ねない。ブランチが無ければディレクトリ名", () => {
    const rows = boardRows(tree, [], []);
    expect(rows[1]).toMatchObject({ label: "main" });
    expect(rows[2]).toMatchObject({ label: "feat" });
    const detached: ListedTree = structuredClone(tree);
    detached.workspaces[0]!.worktrees[1]!.branch = null;
    expect(boardRows(detached, [], [])[2]).toMatchObject({ label: "api=feat", tags: [] });
  });

  test("worktree の行は、今いるペインを含んでいても示さない", () => {
    const rows = boardRows(tree, [], []);
    expect(rows.filter((r) => r.kind === "worktree").every((r) => !("isCurrentPane" in r))).toBe(true);
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

const treeWithPanes: ListedTree = {
  usage: {},
  workspaces: [
    {
      ...tree.workspaces[0]!,
      worktrees: [{ ...tree.workspaces[0]!.worktrees[0]!, tmux: { session: { name: "api", attached: true }, panes: [{ paneId: "%12", command: "nvim", current: true }, { paneId: "%13", command: "zsh", current: false }] } }, tree.workspaces[0]!.worktrees[1]!],
    },
  ],
};

describe("ペインの行", () => {
  const rows = boardRows(treeWithPanes, [], []);
  const pane = rows.find((r) => r.kind === "pane")!;
  test("worktree の下に並ぶ（実行中のコマンドが名前）", () => {
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "pane", "pane", "worktree", "agent", "agent"]);
    expect(pane).toMatchObject({ key: "%12", label: "nvim", worktree: "/g/o/api" });
  });
  test("今いるペインのペインの行だけが、今いるペインとして示される", () => {
    expect(rows.filter((r) => r.kind === "pane").map((r) => [r.key, r.isCurrentPane])).toEqual([
      ["%12", true],
      ["%13", false],
    ]);
  });
  test("会話ペインが今いるペインなら、そのエージェントの行が示される", () => {
    const t2 = {
      ...tree,
      workspaces: [{ ...tree.workspaces[0]!, worktrees: tree.workspaces[0]!.worktrees.map((w) => ({ ...w, agents: w.agents.map((a) => ({ ...a, tmux: { ...a.tmux, current: a.id === "t1" } })) })) }],
    };
    const agents = boardRows(t2, [], []).filter((r) => r.kind === "agent");
    expect(agents.map((r) => [r.key, r.isCurrentPane]).sort()).toEqual([
      ["t1", true],
      ["t2", false],
    ]);
  });
  test("クリック → ws go %12 --from-app。停止・閉じる・新規・再開は何もしない", () => {
    expect(wsCommandFor(pane, "go")).toEqual(["ws", ["go", "%12", "--from-app"]]);
    for (const action of ["stop", "close", "new", "resume"] as const) expect(wsCommandFor(pane, action)).toBeNull();
  });
  test("j / k で選べて、Enter で移動し、s / x / n では何も起きない", () => {
    expect(moveSelection(rows, "worktree:/g/o/api", 1)).toBe("pane:%12");
    expect(keyActionFor(rows, "pane:%12", "enter")).toMatchObject({ action: "go" });
    for (const k of ["s", "x", "n", "shift-r"]) expect(keyActionFor(rows, "pane:%12", k)).toBeNull();
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
  test("再開は再開できるときだけ", () => {
    expect(wsCommandFor(find(rows, "t2"), "resume")).toEqual(["ws", ["resume", "t2"]]);
    expect(wsCommandFor(find(rows, "t1"), "resume")).toBeNull();
  });
  test("停止 → ws stop <agent>（エージェントの行だけ）", () => {
    expect(wsCommandFor(find(rows, "t1"), "stop")).toEqual(["ws", ["stop", "t1"]]);
    expect(wsCommandFor(wt, "stop")).toBeNull();
  });
  test("tmux セッションを閉じる → ws close <worktree>（セッションのある worktree の行だけ）", () => {
    const main = rows[1]!;
    expect(main).toMatchObject({ hasSession: true });
    expect(wsCommandFor(main, "close")).toEqual(["ws", ["close", "/g/o/api"]]);
    expect(wt).toMatchObject({ hasSession: false });
    expect(wsCommandFor(wt, "close")).toBeNull();
    expect(wsCommandFor(find(rows, "t1"), "close")).toBeNull();
  });
  test("エージェントの行は、動いているかどうかを持つ（停止と、終了済みを消すの出し分け）", () => {
    expect(find(rows, "t1")).toMatchObject({ alive: true });
  });
  test("workspace 行は何もしない", () => expect(wsCommandFor(rows[0]!, "go")).toBeNull());
});

describe("エージェントの行の名前", () => {
  test("端末に名前が無い（名前がアドレスと同じ）ときは、アドレスの番号で agent-N と出す", () => {
    const unnamed: ListedTree = structuredClone(tree);
    unnamed.workspaces[0]!.worktrees[1]!.agents[0]!.name = "t1";
    expect(find(boardRows(unnamed, [], []), "t1")).toMatchObject({ label: "agent-1" });
    expect(find(boardRows(tree, [], []), "t2")).toMatchObject({ label: "t2 api-feat-2" });
  });
});

describe("その他", () => {
  test("toggleCollapsed", () => {
    expect(toggleCollapsed([], "a")).toEqual(["a"]);
    expect(toggleCollapsed(["a"], "a")).toEqual([]);
  });
  test("parseList は壊れた出力でも空の木", () => {
    expect(parseList("oops")).toEqual({ workspaces: [], usage: {} });
  });
});

describe("moveSelection（j / k で上下に動かす）", () => {
  const rows = boardRows(tree, [], []);
  const ids = rows.filter((r) => r.kind !== "workspace").map(rowId);
  test("何も選んでいなければ、下へは先頭、上へは末尾を選ぶ", () => {
    expect(moveSelection(rows, null, 1)).toBe(ids[0]!);
    expect(moveSelection(rows, null, -1)).toBe(ids.at(-1)!);
  });
  test("workspace の行は飛ばし、端では止まる", () => {
    expect(moveSelection(rows, ids[0]!, 1)).toBe(ids[1]!);
    expect(moveSelection(rows, ids[0]!, -1)).toBe(ids[0]!);
    expect(moveSelection(rows, ids.at(-1)!, 1)).toBe(ids.at(-1)!);
  });
  test("選んでいた行が消えたら、選び直す", () => expect(moveSelection(rows, "agent:gone", 1)).toBe(ids[0]!));
  test("選べる行が無ければ null", () => expect(moveSelection([], null, 1)).toBeNull());
});

describe("keyActionFor（選んだ行へのキー操作）", () => {
  const rows = boardRows(tree, [], []);
  const main = rowId(rows[1]!);
  const feat = rowId(rows[2]!);
  const t1 = "agent:t1";
  const t2 = "agent:t2";
  const act = (selected: string | null, key: string) => {
    const hit = keyActionFor(rows, selected, key);
    return hit && { action: hit.action, row: rowId(hit.row) };
  };
  test("Enter は移動、n は ＋ claude（エージェントの行ならその worktree）", () => {
    expect(act(feat, "enter")).toEqual({ action: "go", row: feat });
    expect(act(t1, "n")).toEqual({ action: "new", row: t1 });
  });
  test("s は停止で、エージェントの行だけ", () => {
    expect(act(t1, "s")).toEqual({ action: "stop", row: t1 });
    expect(act(feat, "s")).toBeNull();
  });
  test("x は tmux セッションを閉じる。エージェントの行ならその worktree のセッション。セッションが無ければ何もしない", () => {
    expect(act(main, "x")).toEqual({ action: "close", row: main });
    expect(act(feat, "x")).toBeNull();
    expect(act(t1, "x")).toBeNull();
  });
  test("R（shift-r）は再開できるエージェントだけ", () => {
    expect(act(t2, "shift-r")).toEqual({ action: "resume", row: t2 });
    expect(act(t1, "shift-r")).toBeNull();
  });
  test("割り当ての無いキーと、何も選んでいないときは何もしない", () => {
    expect(act(t1, "q")).toBeNull();
    expect(act(null, "enter")).toBeNull();
  });
});

describe("context 使用率", () => {
  test("エージェントの行に円グラフ用の % と色を持たせる（要再開のエージェントには出さない）", () => {
    const rows = boardRows(tree, [], []);
    const row = (key: string) => rows.find((r) => r.kind === "agent" && r.key === key) as Extract<BoardRow, { kind: "agent" }>;
    expect(row("t1").context).toEqual({ used: 75, tone: "strong", text: "ctx 75%" });
    expect(row("t2").context).toBeUndefined();
  });
});

describe("wsArgsForModCommand", () => {
  test("next / prev を ws next の引数にする", () => {
    expect(wsArgsForModCommand("next")).toEqual(["next", "--from-app"]);
    expect(wsArgsForModCommand("prev")).toEqual(["next", "--prev", "--from-app"]);
  });
  test("廃止した next-blocked などは何もしない", () => expect(wsArgsForModCommand("next-blocked")).toBeNull());
  test("知らないコマンド名は何もしない", () => expect(wsArgsForModCommand("other")).toBeNull());
});
