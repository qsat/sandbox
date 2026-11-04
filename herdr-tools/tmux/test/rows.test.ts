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
  panes: [{ paneId: "%1", agentId: "t1", dead: false, session: "a", command: "claude", current: false }],
});

describe("ペインの行", () => {
  const withPanes = indexTmux(makeLocator(tree, infos), {
    sessions: [{ name: "a", path: A, attached: true }],
    panes: [
      { paneId: "%1", agentId: "t1", dead: false, session: "a", command: "claude", current: false },
      { paneId: "%2", agentId: null, dead: false, session: "a", command: "nvim", current: false },
      { paneId: "%3", agentId: null, dead: true, session: "a", command: "zsh", current: false },
    ],
  });
  const rows = toRows(tree, withPanes, { attentionFirst: true, color: false });
  test("エージェントの行の後ろに、同じ深さで並ぶ（会話ペインと死んだペインは出ない）", () => {
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "agent", "agent", "workspace", "worktree", "agent", "pane"]);
    expect(rows.at(-1)).toMatchObject({ kind: "pane", depth: 2, ref: "%2", text: "nvim" });
  });
  test("選べる行で、選択を保てる", () => {
    expect(keepSelectionOn(rows, "%2")).toBe(rows.length - 1);
    expect(nextSelectable(rows, 6, 1)).toBe(7);
  });
});

describe("toRows", () => {
  test("blocked を含む workspace / agent が先頭", () => {
    const rows = toRows(tree, idx, { attentionFirst: true, color: false });
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "agent", "agent", "workspace", "worktree", "agent"]);
    expect(rows[0]!.text).toBe("x/b");
    expect(rows.filter((r) => r.kind === "agent").map((r) => (r.kind === "agent" ? r.ref : ""))).toEqual(["t3", "t2", "t1"]);
  });

  test("tmux の情報（セッション・未attach）を添える", () => {
    const text = renderText(tree, idx, {}, false);
    expect(text).toContain("a [main] tmux*");
    expect(text).toMatch(/t1 +t1 +working$/m);
    expect(text).toMatch(/t2 +t2 +idle +未attach/);
  });

  test("今いるペインは、そのペインの行だけが示される（worktree の行は示されない）", () => {
    const here = indexTmux(makeLocator(tree, infos), {
      sessions: [{ name: "a", path: A, attached: true }],
      panes: [
        { paneId: "%1", agentId: "t1", dead: false, session: "a", command: "claude", current: false },
        { paneId: "%2", agentId: null, dead: false, session: "a", command: "nvim", current: true },
        { paneId: "%4", agentId: null, dead: false, session: "a", command: "zsh", current: false },
      ],
    });
    const rows = toRows(tree, here, { attentionFirst: false, color: false });
    expect(rows.filter((r) => r.kind === "pane").map((r) => [r.ref, r.isCurrentPane])).toEqual([
      ["%2", true],
      ["%4", false],
    ]);
    expect(rows.filter((r) => r.kind === "agent").map((r) => r.isCurrentPane)).toEqual([false, false, false]);
    expect(rows.filter((r) => r.kind === "worktree").every((r) => !("isCurrentPane" in r))).toBe(true);
  });

  test("会話ペインが今いるペインなら、そのエージェントの行が示される", () => {
    const here = indexTmux(makeLocator(tree, infos), {
      sessions: [{ name: "a", path: A, attached: true }],
      panes: [{ paneId: "%1", agentId: "t1", dead: false, session: "a", command: "claude", current: true }],
    });
    const rows = toRows(tree, here, { attentionFirst: false, color: false });
    expect(rows.filter((r) => r.kind === "agent").map((r) => [r.ref, r.isCurrentPane])).toEqual([
      ["t1", true],
      ["t2", false],
      ["t3", false],
    ]);
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
    expect(renderText(withLost, lostIdx, {}, false)).not.toContain("R で再開");
  });
});

describe("toRows（popup はボードと同じ見せ方）", () => {
  const rows = toRows(tree, idx, { attentionFirst: true, color: false, look: "board" });
  test("リポジトリの間に空行を入れ、空行は選べない", () => {
    expect(rows.map((r) => r.kind)).toEqual(["workspace", "worktree", "agent", "agent", "spacer", "workspace", "worktree", "agent"]);
    expect(nextSelectable(rows, 3, 1)).toBe(6);
  });
  test("worktree はブランチ名とタグ、エージェントは名前・アイコン・状態の順", () => {
    expect(rows[6]!.text).toBe("main tmux*");
    expect(rows[2]!.text).toBe("agent-3 ▲ blocked 未attach");
    expect(rows[7]!.text).toBe("agent-1 ● working");
    expect(rows[3]!.text).toBe("agent-2 ○ idle 未attach");
  });
  test("ws list（plain）はアドレスを出したまま、空行を入れない", () => {
    expect(renderText(tree, idx, {}, false)).not.toContain("agent-");
    expect(toRows(tree, idx, { attentionFirst: true, color: false }).some((r) => r.kind === "spacer")).toBe(false);
  });
  test("tmux セッションの無い worktree の名前はグレーにする", () => {
    const colored = toRows(tree, idx, { attentionFirst: true, color: true, look: "board" });
    const nameOf = (path: string) => colored.find((r) => r.kind === "worktree" && r.ref === path)!.text;
    expect(nameOf(B).startsWith("\x1b[90m")).toBe(true);
    expect(nameOf(A).startsWith("\x1b[90m")).toBe(false);
  });
});

describe("splitKeys", () => {
  test("まとめて届いた入力を1キーずつに", () => {
    expect(splitKeys("jjq")).toEqual(["j", "j", "q"]);
    expect(splitKeys("\x1b[Bj\r")).toEqual(["\x1b[B", "j", "\r"]);
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });
});

describe("context 使用率", () => {
  test("エージェントの行に ctx 42% を出す", () => {
    const withContext = buildTree({ agents: [{ ...t("t1", A, "working"), contextUsedPercentage: 42 }], inspections: infos, alwaysShow: [], ghqRoot: "/g" });
    expect(renderText(withContext, indexTmux(makeLocator(withContext, infos), { sessions: [], panes: [] }), {}, false)).toContain("ctx 42%");
  });
});
