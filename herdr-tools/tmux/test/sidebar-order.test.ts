import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListedTree } from "../src/list-json";
import { currentRowId, goRefOf, itemId, rowIdOfPane, sidebarItems, stepFrom, steppableItems } from "../src/sidebar-order";
import { readCollapsed, readStepRecord, writeStepRecord } from "../src/step-state";

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
  test("移る先に数える行は workspace の見出しを除いたもので、移る先の ref は worktree のパス・エージェントの id・ペインの id", () => {
    const rows = steppableItems(sidebarItems(list, [], []));
    expect(rows.some((r) => (r.kind as string) === "workspace")).toBe(false);
    expect(rows.map(goRefOf)).toEqual(["/g/o/api", "%1", "/g/o/api=feat", "t2", "t1", "%2", "/g/o/web", "w1"]);
  });
});

describe("次・前の行を選ぶ", () => {
  const rows = steppableItems(sidebarItems(list, [], []));
  const next = (cur: string | undefined, prev = false) => (stepFrom(rows, cur, prev) ? itemId(stepFrom(rows, cur, prev)!) : undefined);
  test("今いる行の 1 つ下・1 つ上へ移る", () => {
    expect(next("agent:t2")).toBe("agent:t1");
    expect(next("agent:t2", true)).toBe("worktree:/g/o/api=feat");
  });
  test("端では反対の端へ回る", () => {
    expect(next("agent:w1")).toBe("worktree:/g/o/api");
    expect(next("worktree:/g/o/api", true)).toBe("agent:w1");
  });
  test("今いる行が列に無ければ、下は先頭・上は最後", () => {
    expect(next("agent:zzz")).toBe("worktree:/g/o/api");
    expect(next(undefined)).toBe("worktree:/g/o/api");
    expect(next(undefined, true)).toBe("agent:w1");
  });
  test("行が 1 つも無ければ移る先なし", () => expect(stepFrom([], "x", false)).toBeUndefined());
});

describe("今いる行", () => {
  test("会話ペインならエージェントの行、そうでなければペインの行", () => {
    expect(rowIdOfPane("%5", "t1")).toBe("agent:t1");
    expect(rowIdOfPane("%5", null)).toBe("pane:%5");
  });
  test("記録のペインが今いるペインと同じなら記録の行（worktree の行へ移った直後）", () => {
    expect(currentRowId({ pane: "%7", agentId: null, record: { row: "worktree:/g/o/api", pane: "%7" } })).toBe("worktree:/g/o/api");
  });
  test("記録のペインと違えば、今いるペインから決める", () => {
    expect(currentRowId({ pane: "%8", agentId: "t1", record: { row: "worktree:/g/o/api", pane: "%7" } })).toBe("agent:t1");
    expect(currentRowId({ pane: "%8", agentId: null, record: null })).toBe("pane:%8");
  });
  test("今いるペインが分からなければ行も決まらない", () => expect(currentRowId({ pane: undefined, agentId: null, record: null })).toBeUndefined());
});

describe("畳んだ workspace と記録のファイル", () => {
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
  test("記録は、フォルダーが無くても書け、読み戻せる。壊れていれば null", async () => {
    const path = join(dir, "sub", "step-last.json");
    expect(await readStepRecord(path)).toBeNull();
    await writeStepRecord(path, { row: "agent:t1", pane: "%3" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ row: "agent:t1", pane: "%3" });
    expect(await readStepRecord(path)).toEqual({ row: "agent:t1", pane: "%3" });
    writeFileSync(path, "xx");
    expect(await readStepRecord(path)).toBeNull();
  });
});
