import { describe, expect, test } from "bun:test";
import {
  buildTree,
  chooseClient,
  collectCandidatePaths,
  findContainingPath,
  isUnderPath,
  needsResume,
  planGo,
  planPanes,
  planPrune,
  resolveRef,
  sessionNameFor,
  terminalNameFor,
  type PathInfo,
  type Terminal,
  type TmuxPane,
  type TmuxSession,
} from "../src/domain";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const API_FEAT = `${G}/api=feat-auth`;
const WEB = `${G}/web`;

function term(p: Partial<Terminal> & { address: string }): Terminal {
  return { name: p.address, cwd: API, labels: {}, parent: null, state: "live", status: "idle", ...p };
}

const infos: PathInfo[] = [
  { path: API, exists: true, toplevel: API, commonDir: `${API}/.git`, branch: "main" },
  { path: API_FEAT, exists: true, toplevel: API_FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: `${API_FEAT}/src`, exists: true, toplevel: API_FEAT, commonDir: `${API}/.git`, branch: "feat-auth" },
  { path: WEB, exists: true, toplevel: WEB, commonDir: `${WEB}/.git`, branch: "main" },
  { path: `${G}/api=gone`, exists: false },
];

describe("命名規則", () => {
  test("セッション名は basename、. と : は _", () => {
    expect(sessionNameFor(API_FEAT)).toBe("api=feat-auth");
    expect(sessionNameFor(`${G}/my.repo`)).toBe("my_repo");
  });

  test("端末名は <repo>-<branch> を slug 化（= や大文字・/ は使えない）", () => {
    expect(terminalNameFor("api", "feat/Auth", [])).toBe("api-feat-auth");
    expect(terminalNameFor("api", "main", [])).toBe("api-main");
    expect(terminalNameFor("api", null, [])).toBe("api");
    expect(terminalNameFor("API.Server", "x", [])).toBe("api-server-x");
  });

  test("端末名の重複は -2, -3", () => {
    expect(terminalNameFor("api", "main", ["api-main"])).toBe("api-main-2");
    expect(terminalNameFor("api", "main", ["api-main", "api-main-2"])).toBe("api-main-3");
  });

  test("端末名は32文字以内（接尾辞込み）", () => {
    const long = "a".repeat(40);
    const n1 = terminalNameFor(long, "b", []);
    expect(n1.length).toBeLessThanOrEqual(32);
    const n2 = terminalNameFor(long, "b", [n1]);
    expect(n2.length).toBeLessThanOrEqual(32);
    expect(n2.endsWith("-2")).toBe(true);
    expect(/^[a-z0-9_-]{1,32}$/.test(n2)).toBe(true);
  });
});

describe("パス境界", () => {
  test("repo と repo=branch を混ぜない", () => {
    expect(isUnderPath(API_FEAT, API)).toBe(false);
    expect(isUnderPath(`${API}/src`, API)).toBe(true);
    expect(isUnderPath(API, API)).toBe(true);
  });
  test("最も深いものを選ぶ", () => {
    expect(findContainingPath(`${API_FEAT}/src/x`, [API, API_FEAT])).toBe(API_FEAT);
    expect(findContainingPath("/tmp/x", [API])).toBeUndefined();
  });
});

describe("要再開", () => {
  const base = term({ address: "t1", labels: { "claude.session": "abc" }, foreground: { name: "zsh" } });
  test("live・前面がシェル・セッションIDあり", () => expect(needsResume(base)).toBe(true));
  test("ログインシェル表記 -zsh も", () => expect(needsResume({ ...base, foreground: { name: "-zsh" } })).toBe(true));
  test("claude が動いていれば不要", () => expect(needsResume({ ...base, foreground: { name: "claude" } })).toBe(false));
  test("セッションIDが無ければ不要", () => expect(needsResume({ ...base, labels: {} })).toBe(false));
  test("claude_session キーも読む", () => expect(needsResume({ ...base, labels: { claude_session: "x" } })).toBe(true));
  test("終了済みは不要", () => expect(needsResume({ ...base, state: "finished" })).toBe(false));
  test("foreground が分からなければ不要", () => expect(needsResume({ ...base, foreground: undefined })).toBe(false));
});

const terminals: Terminal[] = [
  term({ address: "t1", name: "api-main", cwd: API, labels: { ws: API, wt: API }, status: "working" }),
  term({ address: "t2", name: "api-feat-auth", cwd: `${API_FEAT}/src`, status: "blocked", kind: "permission" }), // ラベル無し、cwd から推定
  term({ address: "t3", name: "old", cwd: "/", labels: { ws: API, wt: `${G}/api=gone`, "claude.session": "s3" }, foreground: { name: "zsh" } }),
  term({ address: "t4", name: "child", cwd: API_FEAT, labels: { wt: API_FEAT }, parent: "t2" }),
];
const sessions: TmuxSession[] = [
  { name: "api", path: API, attached: true },
  { name: "web", path: WEB, attached: false },
];
const panes: TmuxPane[] = [
  { session: "api", windowIndex: 1, windowName: "agents", paneId: "%5", hc: "t1", dead: false },
  { session: "api", windowIndex: 1, windowName: "agents", paneId: "%6", hc: "t4", dead: true },
];

function tree(all = false) {
  return buildTree({ terminals, sessions, panes, infos, ghqEntries: [API, API_FEAT, WEB], ghqRoot: "/Users/me/ghq", home: "/Users/me", all });
}

describe("buildTree", () => {
  test("候補パス: セッションのパスとエージェントの居場所（wt ラベル優先）", () => {
    const c = collectCandidatePaths({ terminals, sessions, ghqEntries: [API, API_FEAT, WEB], all: false });
    expect(c.sort()).toEqual([API, `${API_FEAT}/src`, API_FEAT, `${G}/api=gone`, WEB].sort());
  });

  test("Workspace > Worktree > Agent にまとまる（repo と repo=branch は同じ Workspace）", () => {
    const t = tree();
    expect(t.workspaces.map((w) => w.name)).toEqual(["github.com/o/api", "github.com/o/web"]);
    const api = t.workspaces[0]!;
    expect(api.worktrees.map((w) => w.path)).toEqual([API, `${G}/api=feat-auth`, `${G}/api=gone`]);
    expect(api.worktrees[0]!.isMain).toBe(true);
    expect(api.worktrees[0]!.session).toEqual({ name: "api", attached: true });
    expect(api.worktrees[0]!.agents.map((a) => a.address)).toEqual(["t1"]);
    // サブディレクトリの cwd でも worktree に入る。子エージェントも同じ worktree
    expect(api.worktrees[1]!.agents.map((a) => a.address).sort()).toEqual(["t2", "t4"]);
  });

  test("状態の導出: attach 済み・未 attach・場所消失・要再開", () => {
    const t = tree();
    const agents = new Map(t.workspaces.flatMap((w) => w.worktrees.flatMap((wt) => wt.agents)).map((a) => [a.address, a]));
    expect(agents.get("t1")!.attached).toBe(true);
    expect(agents.get("t1")!.panes).toEqual(["%5"]);
    expect(agents.get("t4")!.attached).toBe(false); // 死んだペインは数えない
    expect(agents.get("t2")!.kind).toBe("permission");
    const gone = t.workspaces[0]!.worktrees[2]!;
    expect(gone.exists).toBe(false);
    expect(agents.get("t3")!.missingLocation).toBe(true);
    expect(agents.get("t3")!.needsResume).toBe(true);
  });

  test("既定ではセッションもエージェントも無い worktree は出さない。--all で出す", () => {
    const lonely = `${G}/lonely`;
    const input = { terminals, sessions, panes, ghqEntries: [API, lonely], ghqRoot: "/Users/me/ghq", home: "/Users/me" };
    const withInfo = [...infos, { path: lonely, exists: true, toplevel: lonely, commonDir: `${lonely}/.git`, branch: "main" }];
    expect(buildTree({ ...input, infos: withInfo, all: false }).workspaces.some((w) => w.path === lonely)).toBe(false);
    expect(buildTree({ ...input, infos: withInfo, all: true }).workspaces.some((w) => w.path === lonely)).toBe(true);
  });
});

describe("resolveRef", () => {
  const t = tree();
  test("アドレス", () => expect(resolveRef(t, "t2")?.kind).toBe("agent"));
  test("端末名", () => expect(resolveRef(t, "api-main")).toMatchObject({ kind: "agent", agent: { address: "t1" } }));
  test("worktree のパス（配下のパスでも）", () => {
    expect(resolveRef(t, API_FEAT)).toMatchObject({ kind: "worktree", worktree: { path: API_FEAT } });
    expect(resolveRef(t, `${API_FEAT}/src/x`)).toMatchObject({ kind: "worktree", worktree: { path: API_FEAT } });
  });
  test("見つからない", () => expect(resolveRef(t, "t99")).toBeUndefined());
});

describe("chooseClient", () => {
  const clients = [
    { name: "/dev/ttys001", session: "api", activity: 100 },
    { name: "/dev/ttys002", session: "web", activity: 200 },
  ];
  test("明示が最優先", () => expect(chooseClient({ explicit: "c", fromApp: true, clients })).toEqual({ kind: "client", name: "c" }));
  test("app からは最後に使われたもの", () => expect(chooseClient({ fromApp: true, clients })).toEqual({ kind: "client", name: "/dev/ttys002" }));
  test("app からでクライアントが無ければ Ghostty 新規", () => expect(chooseClient({ fromApp: true, clients: [] })).toEqual({ kind: "ghostty-new" }));
  test("tmux 内からは呼び出し元", () => expect(chooseClient({ fromApp: false, insideTmuxClient: "me", clients })).toEqual({ kind: "client", name: "me" }));
  test("tmux の外のシェルからはその場で attach", () => expect(chooseClient({ fromApp: false, clients })).toEqual({ kind: "attach" }));
});

describe("planGo（判断フローの全分岐）", () => {
  const t = tree();
  const ctx = { sessions, panes, client: { kind: "client", name: "c1" } as const, fromApp: false, fallbackCwd: "/Users/me" };

  test("worktree・セッションあり → 切り替えるだけ", () => {
    expect(planGo(resolveRef(t, API)!, ctx)).toEqual([{ op: "switchClient", client: "c1", target: "api" }]);
  });

  test("worktree・セッション無し → tm 規則で作ってから切り替え", () => {
    expect(planGo(resolveRef(t, API_FEAT)!, ctx)).toEqual([
      { op: "newSession", name: "api=feat-auth", cwd: API_FEAT },
      { op: "switchClient", client: "c1", target: "api=feat-auth" },
    ]);
  });

  test("agent・attach 済み → そのペインを選ぶ", () => {
    expect(planGo(resolveRef(t, "t1")!, ctx)).toEqual([
      { op: "selectPane", paneId: "%5" },
      { op: "switchClient", client: "c1", target: "%5" },
    ]);
  });

  test("agent・未 attach → agents ウィンドウにペインを作る", () => {
    expect(planGo(resolveRef(t, "t2")!, ctx)).toEqual([
      { op: "newSession", name: "api=feat-auth", cwd: API_FEAT },
      { op: "openAttachPane", session: "api=feat-auth", window: "agents", cwd: API_FEAT, address: "t2" },
      { op: "switchClient", client: "c1", target: "api=feat-auth:agents" },
    ]);
  });

  test("agent・要再開 → 再開してから attach（場所消失なら fallbackCwd でセッションを作る）", () => {
    expect(planGo(resolveRef(t, "t3")!, ctx)).toEqual([
      { op: "newSession", name: "api=gone", cwd: "/Users/me" },
      { op: "resume", address: "t3" },
      { op: "openAttachPane", session: "api=gone", window: "agents", cwd: "/Users/me", address: "t3" },
      { op: "switchClient", client: "c1", target: "api=gone:agents" },
    ]);
  });

  test("app から → 切り替えたあと Ghostty を前面へ", () => {
    const steps = planGo(resolveRef(t, API)!, { ...ctx, fromApp: true });
    expect(steps.at(-1)).toEqual({ op: "focusGhostty" });
  });

  test("app から・クライアント無し → Ghostty の新しいウィンドウで attach", () => {
    expect(planGo(resolveRef(t, API)!, { ...ctx, fromApp: true, client: { kind: "ghostty-new" } })).toEqual([{ op: "ghosttyNewWindow", target: "api" }]);
  });

  test("tmux の外 → その場で attach", () => {
    expect(planGo(resolveRef(t, API)!, { ...ctx, client: { kind: "attach" } })).toEqual([{ op: "attach", target: "api" }]);
  });

  test("同名セッションが既にあれば作らない（別 owner の同名リポジトリ）", () => {
    const steps = planGo(resolveRef(t, API_FEAT)!, { ...ctx, sessions: [...sessions, { name: "api=feat-auth", path: "/elsewhere", attached: false }] });
    expect(steps.some((s) => s.op === "newSession")).toBe(false);
  });
});

describe("planPanes / planPrune", () => {
  const t = tree();
  const feat = t.workspaces[0]!.worktrees[1]!;
  test("既定では子エージェントを含めない", () => {
    expect(planPanes(feat, { includeChildren: false, max: 8 }).open.map((a) => a.address)).toEqual(["t2"]);
  });
  test("-a で子エージェントも", () => {
    expect(planPanes(feat, { includeChildren: true, max: 8 }).open.map((a) => a.address)).toEqual(["t2", "t4"]);
  });
  test("上限を超えた分は省略", () => {
    const r = planPanes(feat, { includeChildren: true, max: 1 });
    expect(r.open.map((a) => a.address)).toEqual(["t2"]);
    expect(r.skipped.map((a) => a.address)).toEqual(["t4"]);
  });
  test("attach 済みは開かない（重複させない）", () => {
    const main = t.workspaces[0]!.worktrees[0]!;
    expect(planPanes(main, { includeChildren: true, max: 8 }).open).toEqual([]);
  });
  test("prune は場所が消えた worktree のエージェント", () => {
    const p = planPrune(t);
    expect(p.agents.map((a) => a.address)).toEqual(["t3"]);
    expect(p.sessions).toEqual([]);
  });
});
