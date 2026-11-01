// WsCore のユースケースを、メモリ上の偽の実行環境と作業場所で検査する。
import { describe, expect, test } from "bun:test";
import { agentsInMissingWorktrees, WsCore, type AgentRecord, type AgentRuntime, type AgentStartSpec, type PathInspection, type WorkspaceSource } from "../src";

class FakeRuntime implements AgentRuntime {
  agents: AgentRecord[] = [];
  sent: [string, string][] = [];
  started: AgentStartSpec[] = [];
  async list() {
    return this.agents.map((a) => ({ ...a }));
  }
  async get(id: string) {
    const a = this.agents.find((x) => x.id === id);
    return a ? { ...a } : undefined;
  }
  async start(spec: AgentStartSpec) {
    this.started.push(spec);
    const id = `a${this.agents.length + 1}`;
    this.agents.push({ id, name: spec.repo, cwd: spec.worktree, status: "working", alive: true, parent: null, recordedWorktree: spec.worktree, recordedWorkspace: spec.workspace });
    return { id, name: spec.repo };
  }
  async recordClaudeSession(id: string, claudeSessionId: string) {
    this.agents.find((a) => a.id === id)!.claudeSessionId = claudeSessionId;
  }
  async type(id: string, text: string) {
    this.sent.push([id, text]);
    this.agents.find((a) => a.id === id)!.programLost = false;
  }
  async stop(id: string) {
    this.agents.find((a) => a.id === id)!.alive = false;
  }
  async remove(id: string) {
    this.agents = this.agents.filter((a) => a.id !== id);
  }
  agentIdOfCurrentProcess(env: Record<string, string | undefined>) {
    return env.FAKE_AGENT;
  }
  attachCommand(id: string) {
    return `fake attach ${id}`;
  }
  subscribe() {
    return () => {};
  }
}

class FakeSource implements WorkspaceSource {
  constructor(private readonly infos: PathInspection[]) {}
  async root() {
    return "/g";
  }
  async entries() {
    return this.infos.filter((i) => i.exists).map((i) => i.path);
  }
  async inspect(paths: string[]) {
    return paths.map((p) => this.infos.find((i) => i.path === p) ?? { path: p, exists: false });
  }
}

const REPO = "/g/o/api";
const WT = "/g/o/api=feat";
const source = () =>
  new FakeSource([
    { path: REPO, exists: true, toplevel: REPO, commonDir: `${REPO}/.git`, branch: "main" },
    { path: WT, exists: true, toplevel: WT, commonDir: `${REPO}/.git`, branch: "feat" },
  ]);

describe("WsCore", () => {
  test("newAgent は worktree・本体・ブランチを実行環境に渡す", async () => {
    const rt = new FakeRuntime();
    const core = new WsCore(rt, source(), { claudeBin: "claude" });
    const r = await core.startAgent(WT, ["--model", "x"]);
    expect(r.id).toBe("a1");
    expect(rt.started[0]).toEqual({ workspace: REPO, worktree: WT, repo: "api", branch: "feat", command: ["claude", "--model", "x"] });
  });

  test("newAgent は無いディレクトリを拒む", async () => {
    const core = new WsCore(new FakeRuntime(), source());
    await expect(core.startAgent("/nope")).rejects.toThrow("ディレクトリがありません");
  });

  test("snapshot は include の場所をエージェントが無くても出す", async () => {
    const core = new WsCore(new FakeRuntime(), source());
    const snap = await core.snapshot({ alwaysShow: [REPO] });
    expect(snap.tree.workspaces[0]!.worktrees.map((w) => w.path)).toEqual([REPO]);
    expect(snap.locate(`${REPO}/src`)?.worktree.path).toBe(REPO);
  });

  test("hook: 実行環境の中なら会話IDを記録、外なら何もしない", async () => {
    const rt = new FakeRuntime();
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    expect(await core.recordClaudeSessionFromHook('{"session_id":"s1"}', {})).toEqual({ recorded: false, reason: "not-in-runtime" });
    expect(await core.recordClaudeSessionFromHook("broken", { FAKE_AGENT: "a1" })).toEqual({ recorded: false, reason: "no-session-id" });
    expect(await core.recordClaudeSessionFromHook('{"session_id":"s1"}', { FAKE_AGENT: "a1" })).toEqual({ recorded: true });
    expect(rt.agents[0]!.claudeSessionId).toBe("s1");
  });

  test("resume は要再開のときだけ送り、2回目は何もしない", async () => {
    const rt = new FakeRuntime();
    const core = new WsCore(rt, source(), { resumeWaitMs: 500 });
    await core.startAgent(WT);
    expect(await core.resumeIfNeeded("a1")).toEqual({ resumed: false, reason: "no-session-id" });
    rt.agents[0]!.claudeSessionId = "s'1";
    expect(await core.resumeIfNeeded("a1")).toEqual({ resumed: false, reason: "running" });
    rt.agents[0]!.programLost = true;
    expect(await core.resumeIfNeeded("a1")).toEqual({ resumed: true, claudeSessionId: "s'1" });
    expect(rt.sent).toEqual([["a1", `claude --resume 's'\\''1'`]]);
    expect(await core.resumeIfNeeded("a1")).toEqual({ resumed: false, reason: "running" });
    expect(await core.resumeIfNeeded("zz")).toEqual({ resumed: false, reason: "not-found" });
  });

  test("prune は場所が消えた worktree のエージェントを止めて消す", async () => {
    const rt = new FakeRuntime();
    rt.agents.push({ id: "x", name: "x", cwd: "/", status: "idle", alive: true, parent: null, recordedWorktree: "/g/o/api=gone" });
    const core = new WsCore(rt, source());
    const plan = agentsInMissingWorktrees((await core.snapshot()).tree);
    expect(plan.map((a) => a.id)).toEqual(["x"]);
    await core.removeAgents(plan);
    expect(rt.agents).toEqual([]);
  });
});
