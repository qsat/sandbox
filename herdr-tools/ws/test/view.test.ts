import { describe, expect, test } from "bun:test";
import { buildTree, type Terminal } from "../src/domain";
import { splitKeys } from "../src/ui/popup";
import { moveSelection, reselect, toRows } from "../src/ui/view";

const A = "/g/x/a";
const B = "/g/x/b";
const t = (address: string, cwd: string, status: Terminal["status"]): Terminal => ({ address, name: address, cwd, labels: {}, parent: null, state: "live", status });

const tree = buildTree({
  terminals: [t("t1", A, "working"), t("t2", B, "idle"), t("t3", B, "blocked")],
  sessions: [],
  panes: [],
  infos: [
    { path: A, exists: true, toplevel: A, commonDir: `${A}/.git`, branch: "main" },
    { path: B, exists: true, toplevel: B, commonDir: `${B}/.git`, branch: "main" },
  ],
  ghqEntries: [],
  ghqRoot: "/g",
  all: false,
});

describe("toRows", () => {
  test("blocked を含む workspace / agent が先頭", () => {
    const rows = toRows(tree, { attentionFirst: true, color: false });
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "agent", "agent", "workspace", "worktree", "agent"]);
    expect(rows[0]!.text).toBe("x/b");
    expect(rows.filter((r) => r.kind === "agent").map((r) => (r.kind === "agent" ? r.ref : ""))).toEqual(["t3", "t2", "t1"]);
  });

  test("並べ替えなしなら名前順", () => {
    const rows = toRows(tree, { attentionFirst: false, color: false });
    expect(rows[0]!.text).toBe("x/a");
  });

  test("選択は workspace 行を飛ばし、更新後も同じ対象を保つ", () => {
    const rows = toRows(tree, { attentionFirst: true, color: false });
    expect(moveSelection(rows, 3, 1)).toBe(5);
    expect(moveSelection(rows, 1, -1)).toBe(1);
    expect(reselect(rows, "t1")).toBe(6);
    expect(reselect(rows, "gone")).toBe(1);
  });
});

describe("splitKeys", () => {
  test("まとめて届いた入力を1キーずつに", () => {
    expect(splitKeys("jjq")).toEqual(["j", "j", "q"]);
    expect(splitKeys("\x1b[Bj\r")).toEqual(["\x1b[B", "j", "\r"]);
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });
});
