import { describe, expect, test } from "bun:test";
import { buildTree, makeLocator, resolveRef, type AgentRecord, type PathInfo } from "@herdr-tools/ws-core";
import { withTmux } from "../src/json";
import { chooseClient, indexTmux, interestingPaths, planGo, planPanes, planPruneSessions, sessionNameFor, type TmuxFacts } from "../src/model";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat-auth`;
const GONE = `${G}/api=gone`;
const WEB = `${G}/web`;

const a = (p: Partial<AgentRecord> & { id: string }): AgentRecord => ({ name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p });

const infos: PathInfo[] = [
  { path: API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" },
  { path: FEAT, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: WEB, exists: true, toplevel: WEB, commonDir: `${WEB}/.git`, branch: "main" },
  { path: GONE, exists: false },
];
const agents = [
  a({ id: "t1", cwd: API, worktreeHint: API, status: "working" }),
  a({ id: "t2", cwd: FEAT, status: "blocked" }),
  a({ id: "t3", cwd: "/", workspaceHint: API, worktreeHint: GONE, sessionId: "s", programLost: true }),
  a({ id: "t4", cwd: FEAT, parent: "t2" }),
];
const facts: TmuxFacts = {
  sessions: [
    { name: "api", path: API, attached: true },
    { name: "web", path: `${WEB}/`, attached: false },
    { name: "api=gone", path: GONE, attached: false },
  ],
  panes: [
    { paneId: "%5", agent: "t1", dead: false },
    { paneId: "%6", agent: "t4", dead: true },
  ],
};

const tree = buildTree({ agents, infos, root: "/Users/me/ghq", include: interestingPaths(facts) });
const locate = makeLocator(tree, infos);
const idx = indexTmux(locate, facts);
const ctx = { client: { kind: "client", name: "c1" } as const, fromApp: false, fallbackCwd: "/Users/me" };
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
  test("withTmux は tmux キーで添える（core の木は変えない）", () => {
    const j = withTmux(tree, idx);
    const wt = j.workspaces[0]!.worktrees[0]!;
    expect(wt.tmux.session).toEqual({ name: "api", attached: true });
    expect(wt.agents[0]!.tmux).toEqual({ attached: true, panes: ["%5"] });
    expect("tmux" in tree.workspaces[0]!.worktrees[0]!).toBe(false);
  });
  test("セッション名は basename、. と : は _", () => {
    expect(sessionNameFor(FEAT)).toBe("api=feat-auth");
    expect(sessionNameFor(`${G}/my.repo`)).toBe("my_repo");
  });
});

describe("chooseClient", () => {
  const clients = [
    { name: "/dev/ttys001", activity: 100 },
    { name: "/dev/ttys002", activity: 200 },
  ];
  test("明示が最優先", () => expect(chooseClient({ explicit: "c", fromApp: true, clients })).toEqual({ kind: "client", name: "c" }));
  test("app からは最後に使われたもの", () => expect(chooseClient({ fromApp: true, clients })).toEqual({ kind: "client", name: "/dev/ttys002" }));
  test("app からでクライアントが無ければ Ghostty 新規", () => expect(chooseClient({ fromApp: true, clients: [] })).toEqual({ kind: "ghostty-new" }));
  test("tmux 内からは呼び出し元", () => expect(chooseClient({ fromApp: false, insideTmuxClient: "me", clients })).toEqual({ kind: "client", name: "me" }));
  test("tmux の外のシェルからはその場で attach", () => expect(chooseClient({ fromApp: false, clients })).toEqual({ kind: "attach" }));
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
  test("agent・会話ペインあり → 準備（再開の判定）してからそのペインを選ぶ", () => {
    expect(planGo(r("t1"), idx, ctx)).toEqual([
      { op: "prepareAgent", agent: "t1" },
      { op: "selectPane", paneId: "%5" },
      { op: "switchClient", client: "c1", target: "%5" },
    ]);
  });
  test("agent・会話ペイン無し → agents ウィンドウに作る（要再開かどうかに関わらず準備は毎回）", () => {
    expect(planGo(r("t2"), idx, ctx)).toEqual([
      { op: "newSession", name: "api=feat-auth", cwd: FEAT },
      { op: "prepareAgent", agent: "t2" },
      { op: "openAgentPane", session: "api=feat-auth", window: "agents", cwd: FEAT, agent: "t2" },
      { op: "switchClient", client: "c1", target: "api=feat-auth:agents" },
    ]);
  });
  test("agent・要再開 → 準備（再開）してから。場所消失なら fallbackCwd", () => {
    expect(planGo(r("t3"), idx, ctx)).toEqual([
      { op: "prepareAgent", agent: "t3" },
      { op: "openAgentPane", session: "api=gone", window: "agents", cwd: "/Users/me", agent: "t3" },
      { op: "switchClient", client: "c1", target: "api=gone:agents" },
    ]);
  });
  test("app から → Ghostty を前面へ", () => {
    expect(planGo(r(API), idx, { ...ctx, fromApp: true }).at(-1)).toEqual({ op: "focusGhostty" });
  });
  test("app から・クライアント無し → Ghostty の新しいウィンドウ", () => {
    expect(planGo(r(API), idx, { ...ctx, fromApp: true, client: { kind: "ghostty-new" } })).toEqual([{ op: "ghosttyNewWindow", target: "api" }]);
  });
  test("tmux の外 → その場で attach", () => {
    expect(planGo(r(API), idx, { ...ctx, client: { kind: "attach" } })).toEqual([{ op: "attach", target: "api" }]);
  });
  test("同名セッションが既にあれば作らない", () => {
    const f2 = { ...facts, sessions: [...facts.sessions, { name: "api=feat-auth", path: "/elsewhere", attached: false }] };
    const idx2 = indexTmux(makeLocator(tree, infos), f2);
    expect(planGo(r(FEAT), idx2, ctx).some((s) => s.op === "newSession")).toBe(false);
  });
});

describe("planPanes / planPruneSessions", () => {
  const feat = tree.workspaces[0]!.worktrees.find((w) => w.path === FEAT)!;
  test("既定では子を含めない、-a で含める", () => {
    expect(planPanes(feat, idx, { includeChildren: false, max: 8 }).open.map((x) => x.id)).toEqual(["t2"]);
    expect(planPanes(feat, idx, { includeChildren: true, max: 8 }).open.map((x) => x.id)).toEqual(["t2", "t4"]);
  });
  test("上限を超えた分は省略", () => {
    const p = planPanes(feat, idx, { includeChildren: true, max: 1 });
    expect(p.skipped.map((x) => x.id)).toEqual(["t4"]);
  });
  test("開いているものは開かない", () => {
    const main = tree.workspaces[0]!.worktrees[0]!;
    expect(planPanes(main, idx, { includeChildren: true, max: 8 }).open).toEqual([]);
  });
  test("場所が消えた worktree のセッション", () => expect(planPruneSessions(tree, idx)).toEqual(["api=gone"]));
});
