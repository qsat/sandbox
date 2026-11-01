import { describe, expect, test } from "bun:test";
import {
  buildTree,
  collectCandidatePaths,
  findContainingPath,
  isUnderPath,
  makeLocator,
  needsResume,
  planPrune,
  resolveRef,
  type AgentRecord,
  type PathInfo,
} from "../src";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat-auth`;
const WEB = `${G}/web`;
const GONE = `${G}/api=gone`;

function agent(p: Partial<AgentRecord> & { id: string }): AgentRecord {
  return { name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p };
}

const infos: PathInfo[] = [
  { path: API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" },
  { path: FEAT, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: `${FEAT}/src`, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: WEB, exists: true, toplevel: WEB, commonDir: `${WEB}/.git`, branch: "main" },
  { path: GONE, exists: false },
];

const agents: AgentRecord[] = [
  agent({ id: "t1", name: "api-main", cwd: API, workspaceHint: API, worktreeHint: API, status: "working" }),
  agent({ id: "t2", name: "api-feat-auth", cwd: `${FEAT}/src`, status: "blocked", kind: "permission" }), // 記録なし、cwd から推定
  agent({ id: "t3", name: "old", cwd: "/", workspaceHint: API, worktreeHint: GONE, sessionId: "s3", programLost: true }),
  agent({ id: "t4", name: "child", cwd: FEAT, worktreeHint: FEAT, parent: "t2" }),
];

const tree = (opts: { all?: boolean; include?: string[] } = {}) =>
  buildTree({ agents, infos, entries: [API, FEAT, WEB], root: "/Users/me/ghq", home: "/Users/me", all: !!opts.all, include: opts.include });

describe("パス境界", () => {
  test("repo と repo=branch を混ぜない", () => {
    expect(isUnderPath(FEAT, API)).toBe(false);
    expect(isUnderPath(`${API}/src`, API)).toBe(true);
    expect(isUnderPath(API, API)).toBe(true);
  });
  test("最も深いものを選ぶ", () => {
    expect(findContainingPath(`${FEAT}/src/x`, [API, FEAT])).toBe(FEAT);
    expect(findContainingPath("/tmp/x", [API])).toBeUndefined();
  });
});

describe("要再開", () => {
  const base = agent({ id: "t1", sessionId: "abc", programLost: true });
  test("生きている・プログラムを失った・会話IDあり", () => expect(needsResume(base)).toBe(true));
  test("プログラムが動いていれば不要", () => expect(needsResume({ ...base, programLost: false })).toBe(false));
  test("分からなければ不要", () => expect(needsResume({ ...base, programLost: undefined })).toBe(false));
  test("会話IDが無ければ不要", () => expect(needsResume({ ...base, sessionId: undefined })).toBe(false));
  test("終了済みは不要", () => expect(needsResume({ ...base, alive: false })).toBe(false));
});

describe("buildTree", () => {
  test("候補パス: エージェントの居場所（記録を優先）と include", () => {
    const c = collectCandidatePaths({ agents, entries: [API, FEAT, WEB], all: false, include: [WEB] });
    expect(c.sort()).toEqual([API, `${FEAT}/src`, FEAT, GONE, WEB].sort());
  });

  test("Workspace > Worktree > Agent（repo と repo=branch は同じ Workspace）", () => {
    const t = tree();
    expect(t.workspaces.map((w) => w.name)).toEqual(["github.com/o/api"]);
    const api = t.workspaces[0]!;
    expect(api.worktrees.map((w) => w.path)).toEqual([API, FEAT, GONE]);
    expect(api.worktrees[0]!.isMain).toBe(true);
    expect(api.worktrees[0]!.agents.map((a) => a.id)).toEqual(["t1"]);
    // サブディレクトリの cwd でも worktree に入る。子エージェントも同じ worktree
    expect(api.worktrees[1]!.agents.map((a) => a.id).sort()).toEqual(["t2", "t4"]);
  });

  test("場所消失と要再開を導く", () => {
    const gone = tree().workspaces[0]!.worktrees[2]!;
    expect(gone.exists).toBe(false);
    expect(gone.agents[0]).toMatchObject({ id: "t3", missingLocation: true, needsResume: true });
  });

  test("include はエージェントがいなくても出す（クライアントのセッションの場所など）", () => {
    expect(tree().workspaces.some((w) => w.path === WEB)).toBe(false);
    expect(tree({ include: [WEB] }).workspaces.some((w) => w.path === WEB)).toBe(true);
  });

  test("all で全エントリ", () => {
    expect(tree({ all: true }).workspaces.map((w) => w.path)).toEqual([API, WEB]);
  });
});

describe("makeLocator", () => {
  const t = tree({ include: [WEB] });
  const locate = makeLocator(t, infos);
  test("生のパスから worktree", () => expect(locate(`${FEAT}/src`)?.worktree.path).toBe(FEAT));
  test("末尾 / 付き・配下のパスでも", () => {
    expect(locate(`${API}/`)?.worktree.path).toBe(API);
    expect(locate(`${WEB}/docs`)?.worktree.path).toBe(WEB);
  });
  test("知らない場所", () => expect(locate("/tmp/x")).toBeUndefined());
});

describe("resolveRef", () => {
  const t = tree();
  test("id", () => expect(resolveRef(t, "t2")?.kind).toBe("agent"));
  test("名前", () => expect(resolveRef(t, "api-main")).toMatchObject({ kind: "agent", agent: { id: "t1" } }));
  test("worktree のパス（配下でも）", () => {
    expect(resolveRef(t, FEAT)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
    expect(resolveRef(t, `${FEAT}/src/x`)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
  });
  test("見つからない", () => expect(resolveRef(t, "t99")).toBeUndefined());
});

describe("planPrune", () => {
  test("場所が消えた worktree のエージェント", () => {
    const p = planPrune(tree());
    expect(p.worktrees.map((w) => w.path)).toEqual([GONE]);
    expect(p.agents.map((a) => a.id)).toEqual(["t3"]);
  });
});
