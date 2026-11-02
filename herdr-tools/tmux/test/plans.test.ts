import { describe, expect, test } from "bun:test";
import { buildTree, makeLocator, resolveRef, type AgentRecord, type PathInspection } from "@herdr-tools/ws-core";
import type { TmuxFacts } from "../src/facts";
import { toListJson } from "../src/list-json";
import { chooseClient, planGo } from "../src/plans/go";
import { planPanes } from "../src/plans/panes";
import { sessionsOfMissingWorktrees } from "../src/plans/prune";
import { indexTmux, sessionPaths, tmSessionName } from "../src/tmux-index";

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
    { paneId: "%5", agentId: "t1", dead: false },
    { paneId: "%6", agentId: "t4", dead: true },
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
    expect(wt.agents[0]!.tmux).toEqual({ attached: true, panes: ["%5"] });
    expect("tmux" in tree.workspaces[0]!.worktrees[0]!).toBe(false);
  });
  test("セッション名は basename、. と : は _", () => {
    expect(tmSessionName(FEAT)).toBe("api=feat-auth");
    expect(tmSessionName(`${G}/my.repo`)).toBe("my_repo");
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
  test("既定では子を含めない、-a で含める", () => {
    expect(planPanes(feat, idx, { includeChildren: false, max: 8 }).open.map((x) => x.id)).toEqual(["t2"]);
    expect(planPanes(feat, idx, { includeChildren: true, max: 8 }).open.map((x) => x.id)).toEqual(["t2", "t4"]);
  });
  test("上限を超えた分は省略", () => {
    const p = planPanes(feat, idx, { includeChildren: true, max: 1 });
    expect(p.overLimit.map((x) => x.id)).toEqual(["t4"]);
  });
  test("開いているものは開かない", () => {
    const main = tree.workspaces[0]!.worktrees[0]!;
    expect(planPanes(main, idx, { includeChildren: true, max: 8 }).open).toEqual([]);
  });
  test("場所が消えた worktree のセッション", () => expect(sessionsOfMissingWorktrees(tree, idx)).toEqual(["api=gone"]));
});
