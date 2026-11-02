import { describe, expect, test } from "bun:test";
import {
  buildTree,
  pathsToInspect,
  makeLocator,
  resumable,
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

const recordedAtMain = agent({ id: "t1", name: "api-main", cwd: API, recordedWorkspace: API, recordedWorktree: API, status: "working" });
const unrecordedInSubdirOfFeat = agent({ id: "t2", name: "api-feat-auth", cwd: `${FEAT}/src`, status: "blocked", blockedReason: "permission" });
const lostInDeletedWorktree = agent({ id: "t3", name: "old", cwd: "/", recordedWorkspace: API, recordedWorktree: GONE, claudeSessionId: "s3", programLost: true });
const childOfT2 = agent({ id: "t4", name: "child", cwd: FEAT, recordedWorktree: FEAT, parent: "t2" });
const agents = [recordedAtMain, unrecordedInSubdirOfFeat, lostInDeletedWorktree, childOfT2];

const GHQ_ENTRIES = [API, FEAT, WEB];
const tree = (opts: { allEntries?: boolean; alwaysShow?: string[] } = {}) =>
  buildTree({ agents, inspections: infos, alwaysShow: [...(opts.alwaysShow ?? []), ...(opts.allEntries ? GHQ_ENTRIES : [])], ghqRoot: "/Users/me/ghq", home: "/Users/me" });

describe("再開できる（claude --resume を打ち込める）", () => {
  const base = agent({ id: "t1", claudeSessionId: "abc", programLost: true });
  test("生きている・claude が前面にいない・会話IDあり", () => expect(resumable(base)).toBe(true));
  test("claude が動いていれば再開しない", () => expect(resumable({ ...base, programLost: false })).toBe(false));
  test("前面が分からなければ再開しない", () => expect(resumable({ ...base, programLost: undefined })).toBe(false));
  test("会話IDが無ければ再開できない", () => expect(resumable({ ...base, claudeSessionId: undefined })).toBe(false));
  test("端末が終了していれば打ち込む先が無い", () => expect(resumable({ ...base, alive: false })).toBe(false));
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
    expect(api.worktrees[0]!.agents.map((a) => a.id)).toEqual([recordedAtMain.id]);
  });

  test("記録が無くても cwd（サブディレクトリでも）から worktree に入り、子エージェントも同じ worktree", () => {
    const feat = tree().workspaces[0]!.worktrees.find((w) => w.path === FEAT)!;
    expect(feat.agents.map((a) => a.id).sort()).toEqual([unrecordedInSubdirOfFeat.id, childOfT2.id]);
  });

  test("場所消失と、再開できることを導く", () => {
    const gone = tree().workspaces[0]!.worktrees[2]!;
    expect(gone.exists).toBe(false);
    expect(gone.agents[0]).toMatchObject({ id: lostInDeletedWorktree.id, missingLocation: true, resumable: true });
  });

  test("alwaysShow はエージェントがいなくても出す（クライアントのセッションの場所など）", () => {
    expect(tree().workspaces.some((w) => w.path === WEB)).toBe(false);
    expect(tree({ alwaysShow: [WEB] }).workspaces.some((w) => w.path === WEB)).toBe(true);
  });

  test("all で全エントリ", () => {
    expect(tree({ allEntries: true }).workspaces.map((w) => w.path)).toEqual([API, WEB]);
  });
});

describe("makeLocator", () => {
  const t = tree({ alwaysShow: [WEB] });
  const locate = makeLocator(t, infos);
  test("生のパスから worktree", () => expect(locate(`${FEAT}/src`)?.worktree.path).toBe(FEAT));
  test("末尾 / 付き・配下のパスでも", () => {
    expect(locate(`${API}/`)?.worktree.path).toBe(API);
    expect(locate(`${WEB}/docs`)?.worktree.path).toBe(WEB);
  });
  test("知らない場所", () => expect(locate("/tmp/x")).toBeUndefined());
});

describe("resolveRef", () => {
  const SYMLINK_TO_API = "/Users/me/link-to-api";
  const t = tree();
  const snap = { tree: t, locate: makeLocator(t, [...infos, { path: SYMLINK_TO_API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" }]) };
  test("id", () => expect(resolveRef(snap, "t2")?.kind).toBe("agent"));
  test("名前", () => expect(resolveRef(snap, "api-main")).toMatchObject({ kind: "agent", agent: { id: "t1" } }));
  test("worktree のパス（配下でも）", () => {
    expect(resolveRef(snap, FEAT)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
    expect(resolveRef(snap, `${FEAT}/src/x`)).toMatchObject({ kind: "worktree", worktree: { path: FEAT } });
  });
  test("リンク経由のパスも調べた toplevel で解決する", () => {
    expect(resolveRef(snap, SYMLINK_TO_API)).toMatchObject({ kind: "worktree", worktree: { path: API } });
  });
  test("見つからない", () => {
    expect(resolveRef(snap, "t99")).toBeUndefined();
    expect(resolveRef(snap, "/tmp/x")).toBeUndefined();
  });
});

describe("agentsInMissingWorktrees", () => {
  test("場所が消えた worktree のエージェント", () => {
    expect(agentsInMissingWorktrees(tree()).map((a) => a.id)).toEqual([lostInDeletedWorktree.id]);
  });
});
