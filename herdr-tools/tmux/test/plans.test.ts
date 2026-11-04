import { describe, expect, test } from "bun:test";
import { buildTree, makeLocator, resolveRef, type AgentRecord, type PathInspection } from "@herdr-tools/ws-core";
import type { TmuxFacts } from "../src/facts";
import { toListJson } from "../src/list-json";
import { chooseClient, planGo } from "../src/plans/go";
import { planPanes } from "../src/plans/panes";
import { sessionsOfMissingWorktrees } from "../src/plans/prune";
import { indexTmux, isPaneId, sessionPaths, tmSessionName } from "../src/tmux-index";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat-auth`;
const GONE = `${G}/api=gone`;
const WEB = `${G}/web`;

const a = (p: Partial<AgentRecord> & { id: string }): AgentRecord => ({ name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p });

const infos: PathInspection[] = [
  { path: API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" },
  { path: FEAT, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: WEB, exists: true, toplevel: WEB, commonDir: `${WEB}/.git`, branch: "main" },
  { path: GONE, exists: false },
];
const agents = [
  a({ id: "t1", cwd: API, recordedWorktree: API, status: "working" }),
  a({ id: "t2", cwd: FEAT, status: "blocked" }),
  a({ id: "t3", cwd: "/", recordedWorkspace: API, recordedWorktree: GONE, claudeSessionId: "s", programLost: true }),
  a({ id: "t4", cwd: FEAT, parent: "t2" }),
];
const facts: TmuxFacts = {
  sessions: [
    { name: "api", path: API, attached: true },
    { name: "web", path: `${WEB}/`, attached: false },
    { name: "api=gone", path: GONE, attached: false },
  ],
  panes: [
    { paneId: "%5", agentId: "t1", dead: false, session: "api", window: "main", command: "claude", current: false },
    { paneId: "%6", agentId: "t4", dead: true, session: "api", window: "main", command: "claude", current: false },
    { paneId: "%7", agentId: null, dead: false, session: "api", window: "main", command: "nvim", current: true },
    { paneId: "%8", agentId: null, dead: false, session: "web", window: "main", command: "zsh", current: false },
    { paneId: "%9", agentId: null, dead: true, session: "web", window: "main", command: "zsh", current: false },
  ],
};

const tree = buildTree({ agents, inspections: infos, ghqRoot: "/Users/me/ghq", alwaysShow: sessionPaths(facts) });
const locate = makeLocator(tree, infos);
const idx = indexTmux(locate, facts);
const ctx = { client: { kind: "switch", name: "c1" } as const, fromApp: false, cwdWhenMissing: "/Users/me" };
const r = (ref: string) => resolveRef({ tree, locate }, ref)!;

describe("索引", () => {
  test("セッションの場所は木に出る（エージェントがいなくても）", () => {
    expect(tree.workspaces.map((w) => w.path)).toEqual([API, WEB]);
  });
  test("worktree → セッション（末尾 / 付きの session_path でも）", () => {
    expect(idx.sessionOf(API)?.name).toBe("api");
    expect(idx.sessionOf(WEB)?.name).toBe("web");
    expect(idx.sessionOf(FEAT)).toBeUndefined();
  });
  test("エージェント → 生きたペインだけ", () => {
    expect(idx.isAttached("t1")).toBe(true);
    expect(idx.isAttached("t4")).toBe(false);
  });
  test("toListJson は tmux キーで添える（core の木は変えない）", () => {
    const j = toListJson(tree, idx, {});
    const wt = j.workspaces[0]!.worktrees[0]!;
    expect(wt.tmux.session).toEqual({ name: "api", attached: true });
    expect(wt.agents[0]!.tmux).toEqual({ attached: true, panes: ["%5"], current: false });
    expect("tmux" in tree.workspaces[0]!.worktrees[0]!).toBe(false);
  });
  test("セッション名は basename、. と : は _", () => {
    expect(tmSessionName(FEAT)).toBe("api=feat-auth");
    expect(tmSessionName(`${G}/my.repo`)).toBe("my_repo");
  });
});

describe("ペイン", () => {
  test("会話ペインと死んだペインを除き、ペインのセッションの worktree に属させる", () => {
    expect(idx.otherPanesOf(API).map((p) => [p.paneId, p.command])).toEqual([["%7", "nvim"]]);
    expect(idx.otherPanesOf(WEB).map((p) => [p.paneId, p.command])).toEqual([["%8", "zsh"]]);
    expect(idx.otherPanesOf(FEAT)).toEqual([]);
  });
  test("ws list --json の worktree.tmux.panes に出る", () => {
    const listed = toListJson(tree, idx, {});
    const api = listed.workspaces.flatMap((w) => w.worktrees).find((w) => w.path === API)!;
    expect(api.tmux.panes).toEqual([{ paneId: "%7", command: "nvim", current: true }]);
  });
  test("ws go %7 は、そのペインのセッションへの切り替えとペインの選択", () => {
    expect(planGo({ kind: "pane", paneId: "%7" }, idx, ctx)).toEqual([
      { op: "selectPane", paneId: "%7" },
      { op: "switchClient", client: "c1", target: "%7" },
    ]);
    expect(planGo({ kind: "pane", paneId: "%7" }, idx, { ...ctx, fromApp: true })).toEqual([
      { op: "selectPane", paneId: "%7" },
      { op: "switchClient", client: "c1", target: "%7" },
      { op: "focusGhostty" },
    ]);
  });
  test("ペインの宛先は %数字 の形で、死んだペインは見つからない", () => {
    expect(isPaneId("%12")).toBe(true);
    expect(isPaneId("t1")).toBe(false);
    expect(idx.livePaneById("%7")).toBeDefined();
    expect(idx.livePaneById("%9")).toBeUndefined();
  });
});

describe("chooseClient", () => {
  const clients = [
    { name: "/dev/ttys001", activity: 100 },
    { name: "/dev/ttys002", activity: 200 },
  ];
  test("明示が最優先", () => expect(chooseClient({ explicit: "c", fromApp: true, clients })).toEqual({ kind: "switch", name: "c" }));
  test("app からは最後に使われたもの", () => expect(chooseClient({ fromApp: true, clients })).toEqual({ kind: "switch", name: "/dev/ttys002" }));
  test("app からでクライアントが無ければ Ghostty 新規", () => expect(chooseClient({ fromApp: true, clients: [] })).toEqual({ kind: "newGhosttyWindow" }));
  test("tmux 内からは呼び出し元", () => expect(chooseClient({ fromApp: false, callerClient: "me", clients })).toEqual({ kind: "switch", name: "me" }));
  test("tmux の外のシェルからはその場で attach", () => expect(chooseClient({ fromApp: false, clients })).toEqual({ kind: "attachHere" }));
  test("tmux が展開しなかった明示（#{client_name} のまま）は無視して呼び出し元へ", () =>
    expect(chooseClient({ explicit: "#{client_name}", fromApp: false, callerClient: "me", clients })).toEqual({ kind: "switch", name: "me" }));
});

describe("planGo（判断フローの全分岐）", () => {
  test("worktree・セッションあり → 切り替えるだけ", () => {
    expect(planGo(r(API), idx, ctx)).toEqual([{ op: "switchClient", client: "c1", target: "api" }]);
  });
  test("worktree・セッション無し → tm 規則で作ってから", () => {
    expect(planGo(r(FEAT), idx, ctx)).toEqual([
      { op: "newSession", name: "api=feat-auth", cwd: FEAT },
      { op: "switchClient", client: "c1", target: "api=feat-auth" },
    ]);
  });
  test("agent・会話ペインあり → そのペインを選ぶ", () => {
    expect(planGo(r("t1"), idx, ctx)).toEqual([
      { op: "selectPane", paneId: "%5" },
      { op: "switchClient", client: "c1", target: "%5" },
    ]);
  });
  test("agent・会話ペイン無し → agents ウィンドウに作る", () => {
    expect(planGo(r("t2"), idx, ctx)).toEqual([
      { op: "newSession", name: "api=feat-auth", cwd: FEAT },
      { op: "openAgentPane", session: "api=feat-auth", window: "agents", cwd: FEAT, agentId: "t2" },
      { op: "switchClient", client: "c1", target: "api=feat-auth:agents" },
    ]);
  });
  test("agent・再開できる → 移動だけで勝手に再開しない（再開は ws resume・ボタン・R）。場所消失なら cwdWhenMissing", () => {
    expect(planGo(r("t3"), idx, ctx)).toEqual([
      { op: "openAgentPane", session: "api=gone", window: "agents", cwd: "/Users/me", agentId: "t3" },
      { op: "switchClient", client: "c1", target: "api=gone:agents" },
    ]);
  });
  test("app から → Ghostty を前面へ", () => {
    expect(planGo(r(API), idx, { ...ctx, fromApp: true }).at(-1)).toEqual({ op: "focusGhostty" });
  });
  test("app から・クライアント無し → Ghostty の新しいウィンドウ", () => {
    expect(planGo(r(API), idx, { ...ctx, fromApp: true, client: { kind: "newGhosttyWindow" } })).toEqual([{ op: "newGhosttyWindow", target: "api" }]);
  });
  test("tmux の外 → その場で attach", () => {
    expect(planGo(r(API), idx, { ...ctx, client: { kind: "attachHere" } })).toEqual([{ op: "attachHere", target: "api" }]);
  });
  test("同名セッションが既にあれば作らない", () => {
    const f2 = { ...facts, sessions: [...facts.sessions, { name: "api=feat-auth", path: "/elsewhere", attached: false }] };
    const idx2 = indexTmux(makeLocator(tree, infos), f2);
    expect(planGo(r(FEAT), idx2, ctx).some((s) => s.op === "newSession")).toBe(false);
  });
});

describe("planPanes / sessionsOfMissingWorktrees", () => {
  const feat = tree.workspaces[0]!.worktrees.find((w) => w.path === FEAT)!;
  const main = tree.workspaces[0]!.worktrees[0]!;
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  test("既定では子を含めない、-a で含める", () => {
    expect(ids(planPanes(feat, idx, { session: "api=feat-auth", includeChildren: false, max: 8 }).open)).toEqual(["t2"]);
    expect(ids(planPanes(feat, idx, { session: "api=feat-auth", includeChildren: true, max: 8 }).open)).toEqual(["t2", "t4"]);
  });
  test("上限を超えた分は省略", () => {
    const p = planPanes(feat, idx, { session: "api=feat-auth", includeChildren: true, max: 1 });
    expect(p.overLimit.map((x) => x.id)).toEqual(["t4"]);
  });
  test("会話ペインが agents ウィンドウの外にあれば、開かずにそのペインを集める", () => {
    const p = planPanes(main, idx, { session: "api", includeChildren: true, max: 8 });
    expect(p.open).toEqual([]);
    expect(p.gather.map((g) => [g.agent.id, g.paneId])).toEqual([["t1", "%5"]]);
  });
  test("agents ウィンドウにもうあれば何もしない", () => {
    const inAgents = indexTmux(locate, { ...facts, panes: facts.panes.map((p) => (p.paneId === "%5" ? { ...p, window: "agents" } : p)) });
    const p = planPanes(main, inAgents, { session: "api", includeChildren: true, max: 8 });
    expect([p.open, p.gather, ids(p.inPlace)]).toEqual([[], [], ["t1"]]);
  });
  test("別のセッションの agents ウィンドウにあるものは集める", () => {
    const elsewhere = indexTmux(locate, { ...facts, panes: facts.panes.map((p) => (p.paneId === "%5" ? { ...p, session: "web", window: "agents" } : p)) });
    expect(planPanes(main, elsewhere, { session: "api", includeChildren: true, max: 8 }).gather.map((g) => g.paneId)).toEqual(["%5"]);
  });
  test("上限は集めるものと開くものを合わせて数える", () => {
    const p = planPanes(main, idx, { session: "api", includeChildren: true, max: 0 });
    expect([p.gather, ids(p.overLimit)]).toEqual([[], ["t1"]]);
  });
  test("場所が消えた worktree のセッション", () => expect(sessionsOfMissingWorktrees(tree, idx)).toEqual(["api=gone"]));
});
