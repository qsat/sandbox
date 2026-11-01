import { describe, expect, test } from "bun:test";
import {
  buildTree,
  pathsToInspect,
  makeLocator,
  needsResume,
  agentsInMissingWorktrees,
  resolveRef,
  type AgentRecord,
  type PathInspection,
} from "../../src";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat-auth`;
const WEB = `${G}/web`;
const GONE = `${G}/api=gone`;

function agent(p: Partial<AgentRecord> & { id: string }): AgentRecord {
  return { name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p };
}

const infos: PathInspection[] = [
  { path: API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" },
  { path: FEAT, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: `${FEAT}/src`, exists: true, toplevel: FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: WEB, exists: true, toplevel: WEB, commonDir: `${WEB}/.git`, branch: "main" },
  { path: GONE, exists: false },
];

const agents: AgentRecord[] = [
  agent({ id: "t1", name: "api-main", cwd: API, recordedWorkspace: API, recordedWorktree: API, status: "working" }),
  agent({ id: "t2", name: "api-feat-auth", cwd: `${FEAT}/src`, status: "blocked", blockedReason: "permission" }), // 記録なし、cwd から推定
  agent({ id: "t3", name: "old", cwd: "/", recordedWorkspace: API, recordedWorktree: GONE, claudeSessionId: "s3", programLost: true }),
  agent({ id: "t4", name: "child", cwd: FEAT, recordedWorktree: FEAT, parent: "t2" }),
];

const ENTRIES = [API, FEAT, WEB];
// snapshot と同じく、--all のときは全エントリを include に足す
const tree = (opts: { all?: boolean; include?: string[] } = {}) =>
  buildTree({ agents, inspections: infos, alwaysShow: [...(opts.include ?? []), ...(opts.all ? ENTRIES : [])], ghqRoot: "/Users/me/ghq", home: "/Users/me" });

describe("要再開", () => {
  const base = agent({ id: "t1", claudeSessionId: "abc", programLost: true });
  test("生きている・プログラムを失った・会話IDあり", () => expect(needsResume(base)).toBe(true));
  test("プログラムが動いていれば不要", () => expect(needsResume({ ...base, programLost: false })).toBe(false));
  test("分からなければ不要", () => expect(needsResume({ ...base, programLost: undefined })).toBe(false));
  test("会話IDが無ければ不要", () => expect(needsResume({ ...base, claudeSessionId: undefined })).toBe(false));
  test("終了済みは不要", () => expect(needsResume({ ...base, alive: false })).toBe(false));
});

describe("buildTree", () => {
  test("候補パス: エージェントの居場所（記録を優先）と include", () => {
    const c = pathsToInspect(agents, [WEB]);
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
  const LINK = "/Users/me/link-to-api"; // シンボリックリンク（git の toplevel は realpath で API になる）
  const t = tree();
  const snap = { tree: t, locate: makeLocator(t, [...infos, { path: LINK, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" }]) };
  test("id", () => expect(resolveRef(snap, "t2")?.kind).toBe("agent"));
  test("名前", () => expect(resolveRef(snap, "api-main")).toMatchObject({ kind: "agent", agent: { id: "t1" } }));
  test("worktree のパス（配下でも）", () => {
    expect(resolveRef(snap, FEAT)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
    expect(resolveRef(snap, `${FEAT}/src/x`)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
  });
  test("リンク経由のパスも調べた toplevel で解決する", () => {
    expect(resolveRef(snap, LINK)).toMatchObject({ kind: "worktree", worktree: { path: API } });
  });
  test("見つからない", () => {
    expect(resolveRef(snap, "t99")).toBeUndefined();
    expect(resolveRef(snap, "/tmp/x")).toBeUndefined();
  });
});

describe("agentsInMissingWorktrees", () => {
  test("場所が消えた worktree のエージェント", () => {
    expect(agentsInMissingWorktrees(tree()).map((a) => a.id)).toEqual(["t3"]);
  });
});
