import { describe, expect, test } from "bun:test";
import { buildTree, makeLocator, type AgentRecord, type PathInspection } from "@herdr-tools/ws-core";
import { indexTmux } from "../src/tmux-index";
import { splitKeys } from "../src/ui/keys";
import { keepSelectionOn, nextSelectable, renderText, toRows } from "../src/ui/rows";

const A = "/g/x/a";
const B = "/g/x/b";
const t = (id: string, cwd: string, status: AgentRecord["status"]): AgentRecord => ({ id, name: id, cwd, status, alive: true, parent: null });
const infos: PathInspection[] = [
  { path: A, exists: true, toplevel: A, commonDir: `${A}/.git`, branch: "main" },
  { path: B, exists: true, toplevel: B, commonDir: `${B}/.git`, branch: "main" },
];
const tree = buildTree({ agents: [t("t1", A, "working"), t("t2", B, "idle"), t("t3", B, "blocked")], inspections: infos, alwaysShow: [], ghqRoot: "/g" });
const idx = indexTmux(makeLocator(tree, infos), {
  sessions: [{ name: "a", path: A, attached: true }],
  panes: [{ paneId: "%1", agentId: "t1", dead: false }],
});

describe("toRows", () => {
  test("blocked を含む workspace / agent が先頭", () => {
    const rows = toRows(tree, idx, { attentionFirst: true, color: false });
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "agent", "agent", "workspace", "worktree", "agent"]);
    expect(rows[0]!.text).toBe("x/b");
    expect(rows.filter((r) => r.kind === "agent").map((r) => (r.kind === "agent" ? r.ref : ""))).toEqual(["t3", "t2", "t1"]);
  });

  test("tmux の情報（セッション・未attach）を添える", () => {
    const text = renderText(tree, idx, false);
    expect(text).toContain("a [main] tmux*");
    expect(text).toMatch(/t1 +t1 +working$/m);
    expect(text).toMatch(/t2 +t2 +idle +未attach/);
  });

  test("選択は workspace 行を飛ばし、更新後も同じ対象を保つ", () => {
    const rows = toRows(tree, idx, { attentionFirst: true, color: false });
    expect(nextSelectable(rows, 3, 1)).toBe(5);
    expect(nextSelectable(rows, 1, -1)).toBe(1);
    expect(keepSelectionOn(rows, "t1")).toBe(6);
    expect(keepSelectionOn(rows, "gone")).toBe(1);
  });

  test("再開できるエージェントは、popup にだけ「R で再開」を添える（ws list の出力には出さない）", () => {
    const lost = { ...t("t4", A, "unknown"), claudeSessionId: "s", programLost: true };
    const withLost = buildTree({ agents: [lost], inspections: infos, alwaysShow: [], ghqRoot: "/g" });
    const lostIdx = indexTmux(makeLocator(withLost, infos), { sessions: [], panes: [] });
    const popupRow = toRows(withLost, lostIdx, { attentionFirst: true, color: false, keyHints: true }).find((r) => r.kind === "agent")!;
    expect(popupRow.text).toContain("R で再開");
    expect(renderText(withLost, lostIdx, false)).not.toContain("R で再開");
  });
});

describe("splitKeys", () => {
  test("まとめて届いた入力を1キーずつに", () => {
    expect(splitKeys("jjq")).toEqual(["j", "j", "q"]);
    expect(splitKeys("\x1b[Bj\r")).toEqual(["\x1b[B", "j", "\r"]);
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });
});
