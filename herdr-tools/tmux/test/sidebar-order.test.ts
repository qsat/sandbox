import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListedTree } from "../src/list-json";
import { goRefOf, itemId, rowIdOfPane, sidebarItems, stepFrom, steppableItems } from "../src/sidebar-order";
import { readCollapsed } from "../src/step-state";

const agent = (id: string, status: "working" | "idle" | "blocked", worktree: string) => ({
  id,
  name: id,
  status,
  resumable: false,
  alive: true,
  cwd: worktree,
  missingLocation: false,
  parent: null,
  tmux: { attached: false, panes: [], current: false },
});

const list: ListedTree = {
  usage: {},
  workspaces: [
    {
      path: "/g/o/api",
      name: "github.com/o/api",
      worktrees: [
        { path: "/g/o/api", branch: "main", exists: true, isMain: true, tmux: { session: { name: "api", attached: true }, panes: [{ paneId: "%1", command: "zsh", current: false }] }, agents: [] },
        {
          path: "/g/o/api=feat",
          branch: "feat",
          exists: true,
          isMain: false,
          tmux: { session: null, panes: [{ paneId: "%2", command: "vim", current: false }] },
          agents: [agent("t1", "idle", "/g/o/api=feat"), agent("t2", "blocked", "/g/o/api=feat")],
        },
      ],
    },
    {
      path: "/g/o/web",
      name: "github.com/o/web",
      worktrees: [{ path: "/g/o/web", branch: "main", exists: true, isMain: true, tmux: { session: null, panes: [] }, agents: [agent("w1", "working", "/g/o/web")] }],
    },
  ],
} as unknown as ListedTree;

const ids = (items: ReturnType<typeof sidebarItems>) => items.map(itemId);

describe("サイドバーの並び", () => {
  test("workspace の見出し → worktree → エージェント（注意が要る順）→ ペインの順に並ぶ", () => {
    expect(ids(sidebarItems(list, [], []))).toEqual([
      "workspace:/g/o/api",
      "worktree:/g/o/api",
      "pane:%1",
      "worktree:/g/o/api=feat",
      "agent:t2",
      "agent:t1",
      "pane:%2",
      "workspace:/g/o/web",
      "worktree:/g/o/web",
      "agent:w1",
    ]);
  });
  test("畳んだ workspace は見出しだけになる", () => {
    expect(ids(sidebarItems(list, [], ["/g/o/api"]))).toEqual(["workspace:/g/o/api", "workspace:/g/o/web", "worktree:/g/o/web", "agent:w1"]);
  });
  test("Herdr app の端末の status があれば、一覧の status より優先して並べ直す", () => {
    const live = [{ address: "t1", status: { state: "blocked", kind: "permission" } }, { address: "t2", status: { state: "idle" } }];
    expect(ids(sidebarItems(list, live, [])).filter((i) => i.startsWith("agent:t"))).toEqual(["agent:t1", "agent:t2"]);
  });
  test("Herdr app の端末が知らない status を名乗っても、先頭には出さず unknown として最後に並べる", () => {
    const items = sidebarItems(list, [{ address: "t2", status: { state: "compacting" } }], []);
    expect(ids(items).filter((i) => i.startsWith("agent:t"))).toEqual(["agent:t1", "agent:t2"]);
    expect(items.flatMap((i) => (i.kind === "agent" && i.key === "t2" ? [i.agent.status] : []))).toEqual(["unknown"]);
  });
  test("移る先に数える行はエージェントとペインだけ（workspace の見出しと worktree の行は飛ばす）で、移る先の ref はエージェントの id・ペインの id", () => {
    const rows = steppableItems(sidebarItems(list, [], []));
    expect(rows.every((r) => r.kind === "agent" || r.kind === "pane")).toBe(true);
    expect(rows.map(goRefOf)).toEqual(["%1", "t2", "t1", "%2", "w1"]);
  });
});

describe("次・前の行を選ぶ", () => {
  const rows = steppableItems(sidebarItems(list, [], []));
  const next = (cur: string | undefined, prev = false) => (stepFrom(rows, cur, prev) ? itemId(stepFrom(rows, cur, prev)!) : undefined);
  test("今いる行の 1 つ下・1 つ上へ移る", () => {
    expect(next("agent:t2")).toBe("agent:t1");
    expect(next("agent:t2", true)).toBe("pane:%1");
  });
  test("端では反対の端へ回る", () => {
    expect(next("agent:w1")).toBe("pane:%1");
    expect(next("pane:%1", true)).toBe("agent:w1");
  });
  test("今いる行が列に無ければ、下は先頭・上は最後", () => {
    expect(next("agent:zzz")).toBe("pane:%1");
    expect(next(undefined)).toBe("pane:%1");
    expect(next(undefined, true)).toBe("agent:w1");
  });
  test("行が 1 つも無ければ移る先なし", () => expect(stepFrom([], "x", false)).toBeUndefined());
});

describe("今いる行", () => {
  test("会話ペインならエージェントの行、そうでなければペインの行", () => {
    expect(rowIdOfPane("%5", "t1")).toBe("agent:t1");
    expect(rowIdOfPane("%5", null)).toBe("pane:%5");
  });
  test("移る先の行（エージェント・ペイン）は、どれも今いるペインから決まる行と同じ id を持つ", () => {
    for (const row of steppableItems(sidebarItems(list, [], []))) {
      expect(itemId(row)).toBe(row.kind === "agent" ? rowIdOfPane("%99", row.key) : rowIdOfPane(row.key, null));
    }
  });
});

describe("畳んだ workspace のファイル", () => {
  const dir = mkdtempSync(join(tmpdir(), "step-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  test("shared.json の agent-board.collapsed を読む。無い・壊れている・形が違うときは何も畳んでいない", async () => {
    writeFileSync(join(dir, "a.json"), JSON.stringify({ "agent-board.collapsed": ["/g/o/api"], other: 1 }));
    writeFileSync(join(dir, "b.json"), "{not json");
    writeFileSync(join(dir, "c.json"), JSON.stringify({ "agent-board.collapsed": "x" }));
    expect(await readCollapsed(join(dir, "a.json"))).toEqual(["/g/o/api"]);
    expect(await readCollapsed(join(dir, "b.json"))).toEqual([]);
    expect(await readCollapsed(join(dir, "c.json"))).toEqual([]);
    expect(await readCollapsed(join(dir, "none.json"))).toEqual([]);
  });
});
