import { describe, expect, test } from "bun:test";
import { agentsInMissingWorktrees, WsCore, type AgentRecord, type AgentRuntime, type AgentStartSpec, type ClaudeUsage, type PathInspection, type UsageStore, type WorkspaceSource } from "../src";

class InMemoryRuntime implements AgentRuntime {
  contextWrites = 0;
  agents: AgentRecord[] = [];
  sent: [string, string][] = [];
  started: AgentStartSpec[] = [];
  getsUntilKilledAgentFinishes = 0;
  private finishing = new Map<string, number>();
  async list() {
    return this.agents.map((a) => ({ ...a }));
  }
  async get(id: string) {
    const left = this.finishing.get(id);
    if (left !== undefined) {
      if (left <= 1) this.finish(id);
      else this.finishing.set(id, left - 1);
    }
    const a = this.agents.find((x) => x.id === id);
    return a ? { ...a } : undefined;
  }
  private finish(id: string) {
    this.finishing.delete(id);
    this.agents.find((a) => a.id === id)!.alive = false;
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
  async recordContextUsage(id: string, usedPercentage: number) {
    this.agents.find((a) => a.id === id)!.contextUsedPercentage = usedPercentage;
    this.contextWrites++;
  }
  async type(id: string, text: string) {
    this.sent.push([id, text]);
    this.agents.find((a) => a.id === id)!.programLost = false;
  }
  async stop(id: string) {
    if (this.getsUntilKilledAgentFinishes === 0) this.finish(id);
    else this.finishing.set(id, this.getsUntilKilledAgentFinishes);
  }
  async remove(id: string) {
    if (this.agents.find((a) => a.id === id)?.alive) throw new Error(`${id} is still running`);
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

class InMemoryWorkspaceSource implements WorkspaceSource {
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
  async worktrees(repo: string) {
    return this.infos.filter((i) => i.commonDir === `${repo}/.git`).map((i) => i.path);
  }
}

const REPO = "/g/o/api";
const WT = "/g/o/api=feat";
const source = () =>
  new InMemoryWorkspaceSource([
    { path: REPO, exists: true, toplevel: REPO, commonDir: `${REPO}/.git`, branch: "main" },
    { path: WT, exists: true, toplevel: WT, commonDir: `${REPO}/.git`, branch: "feat" },
  ]);

describe("WsCore", () => {
  test("newAgent は worktree・本体・ブランチを実行環境に渡す", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source(), { claudeBin: "claude" });
    const r = await core.startAgent(WT, ["--model", "x"]);
    expect(r.id).toBe("a1");
    expect(rt.started[0]).toEqual({ workspace: REPO, worktree: WT, repo: "api", branch: "feat", command: ["claude", "--model", "x"] });
  });

  test("newAgent は無いディレクトリを拒む", async () => {
    const core = new WsCore(new InMemoryRuntime(), source());
    await expect(core.startAgent("/nope")).rejects.toThrow("ディレクトリがありません");
  });

  test("snapshot は include の場所をエージェントが無くても出し、そのリポジトリの worktree をすべて並べる", async () => {
    const core = new WsCore(new InMemoryRuntime(), source());
    const snap = await core.snapshot({ alwaysShow: [REPO] });
    expect(snap.tree.workspaces[0]!.worktrees.map((w) => w.path)).toEqual([REPO, WT]);
    expect(snap.locate(`${REPO}/src`)?.worktree.path).toBe(REPO);
    expect(snap.locate(`${WT}/src`)?.worktree.path).toBe(WT);
  });

  test("エージェントがいる worktree からも、同じリポジトリの他の worktree を並べる", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    const snap = await core.snapshot();
    expect(snap.tree.workspaces[0]!.worktrees.map((w) => w.path)).toEqual([REPO, WT]);
  });

  test("hook: 実行環境の中なら会話IDを記録、外なら何もしない", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    expect(await core.recordClaudeSessionFromHook('{"session_id":"s1"}', {})).toEqual({ recorded: false, reason: "not-in-runtime" });
    expect(await core.recordClaudeSessionFromHook("broken", { FAKE_AGENT: "a1" })).toEqual({ recorded: false, reason: "no-session-id" });
    expect(await core.recordClaudeSessionFromHook('{"session_id":"s1"}', { FAKE_AGENT: "a1" })).toEqual({ recorded: true });
    expect(rt.agents[0]!.claudeSessionId).toBe("s1");
  });

  test("resume は再開できるときだけ送り、2回目は何もしない", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source(), { resumeWaitMs: 500 });
    await core.startAgent(WT);
    expect(await core.resume("a1")).toEqual({ resumed: false, reason: "no-session-id" });
    rt.agents[0]!.claudeSessionId = "s'1";
    expect(await core.resume("a1")).toEqual({ resumed: false, reason: "running" });
    rt.agents[0]!.programLost = true;
    expect(await core.resume("a1")).toEqual({ resumed: true, claudeSessionId: "s'1" });
    expect(rt.sent).toEqual([["a1", `claude --resume 's'\\''1'`]]);
    expect(await core.resume("a1")).toEqual({ resumed: false, reason: "running" });
    expect(await core.resume("zz")).toEqual({ resumed: false, reason: "not-found" });
  });

  test("prune は場所が消えた worktree のエージェントを止めて消す", async () => {
    const rt = new InMemoryRuntime();
    rt.agents.push({ id: "x", name: "x", cwd: "/", status: "idle", alive: true, parent: null, recordedWorktree: "/g/o/api=gone" });
    const core = new WsCore(rt, source());
    const plan = agentsInMissingWorktrees((await core.snapshot()).tree);
    expect(plan.map((a) => a.id)).toEqual(["x"]);
    await core.removeAgents(plan);
    expect(rt.agents).toEqual([]);
  });

  test("prune は終了に時間がかかるエージェントも、終了を待ってから消す", async () => {
    const rt = new InMemoryRuntime();
    rt.getsUntilKilledAgentFinishes = 3;
    rt.agents.push({ id: "x", name: "x", cwd: "/", status: "idle", alive: true, parent: null, recordedWorktree: "/g/o/api=gone" });
    const core = new WsCore(rt, source());
    await core.removeAgents(agentsInMissingWorktrees((await core.snapshot()).tree));
    expect(rt.agents).toEqual([]);
  });
});

describe("WsCore.stopAgent（ws stop: エージェントを止めて一覧から消す）", () => {
  test("動いているエージェントは、終了を待ってから消す", async () => {
    const rt = new InMemoryRuntime();
    rt.getsUntilKilledAgentFinishes = 3;
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    expect(await core.stopAgent("a1")).toEqual({ stopped: true });
    expect(rt.agents).toEqual([]);
  });

  test("終了済みのエージェントは、そのまま消す", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    rt.agents[0]!.alive = false;
    expect(await core.stopAgent("a1")).toEqual({ stopped: true });
    expect(rt.agents).toEqual([]);
  });

  test("名前でも止められる（ws go・ws resume と同じ指し方）。id と同じ名前があれば id を先に引く", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    await core.startAgent(WT);
    await core.startAgent(WT);
    rt.agents[0]!.name = "a2";
    rt.agents[1]!.name = "api-feat";
    expect(await core.stopAgent("api-feat")).toEqual({ stopped: true });
    expect(rt.agents.map((a) => a.id)).toEqual(["a1"]);
    await core.startAgent(WT);
    expect(await core.stopAgent(rt.agents[1]!.id)).toEqual({ stopped: true });
    expect(rt.agents.map((a) => a.name)).toEqual(["a2"]);
  });

  test("エージェントの一覧に無いもの（手で開いたシェルなど）は触らない", async () => {
    const core = new WsCore(new InMemoryRuntime(), source());
    expect(await core.stopAgent("t1")).toEqual({ stopped: false, reason: "not-found" });
  });
});

class InMemoryUsageStore implements UsageStore {
  stored?: ClaudeUsage;
  writes = 0;
  async read() {
    return this.stored;
  }
  async write(usage: ClaudeUsage) {
    this.stored = usage;
    this.writes++;
  }
}

describe("WsCore の利用上限（statusLine で記録し、snapshot で読む）", () => {
  const NOW = 1_800_000_000;
  const statusLine = (used5h: number) =>
    JSON.stringify({ rate_limits: { five_hour: { used_percentage: used5h, resets_at: NOW + 3600 }, seven_day: { used_percentage: 40, resets_at: NOW + 86400 } } });
  const coreWith = (store: InMemoryUsageStore) => new WsCore(new InMemoryRuntime(), source(), { usageStore: store, nowEpochSec: () => NOW });

  test("記録した利用量が snapshot に出る", async () => {
    const store = new InMemoryUsageStore();
    const core = coreWith(store);
    expect(await core.recordClaudeUsageFromStatusLine(statusLine(20))).toMatchObject({ recorded: true });
    expect((await core.snapshot()).usage).toEqual({ fiveHour: { usedPercentage: 20, resetsAtEpochSec: NOW + 3600 }, sevenDay: { usedPercentage: 40, resetsAtEpochSec: NOW + 86400 } });
  });

  test("同じ値なら書かない（statusLine は頻繁に走るので、変化のたびだけ通知する）", async () => {
    const store = new InMemoryUsageStore();
    const core = coreWith(store);
    await core.recordClaudeUsageFromStatusLine(statusLine(20));
    expect(await core.recordClaudeUsageFromStatusLine(statusLine(20))).toMatchObject({ recorded: false, reason: "unchanged" });
    await core.recordClaudeUsageFromStatusLine(statusLine(21));
    expect(store.writes).toBe(2);
  });

  test("rate_limits が無ければ記録せず、前に記録した値を返す", async () => {
    const store = new InMemoryUsageStore();
    const core = coreWith(store);
    await core.recordClaudeUsageFromStatusLine(statusLine(20));
    expect(await core.recordClaudeUsageFromStatusLine("{}")).toMatchObject({ recorded: false, reason: "no-rate-limits", usage: { fiveHour: { usedPercentage: 20 } } });
  });

  test("リセット時刻を過ぎた枠は出さない", async () => {
    const store = new InMemoryUsageStore();
    store.stored = { fiveHour: { usedPercentage: 90, resetsAtEpochSec: NOW - 1 }, sevenDay: { usedPercentage: 40, resetsAtEpochSec: NOW + 10 } };
    expect((await coreWith(store).snapshot()).usage).toEqual({ sevenDay: { usedPercentage: 40, resetsAtEpochSec: NOW + 10 } });
  });

  test("保存先に繋がらなくても、受け取った値は返す（statusLine の表示を止めない）", async () => {
    const unavailable: UsageStore = { read: () => Promise.reject(new Error("hc connect closed")), write: () => Promise.reject(new Error("x")) };
    const core = new WsCore(new InMemoryRuntime(), source(), { usageStore: unavailable, nowEpochSec: () => NOW });
    expect(await core.recordClaudeUsageFromStatusLine(statusLine(20))).toMatchObject({ recorded: false, reason: "store-unavailable", usage: { fiveHour: { usedPercentage: 20 } } });
  });
});

describe("WsCore の context 使用率（statusLine で自分の端末に記録する）", () => {
  const statusLine = (used: number | null) => JSON.stringify({ context_window: { used_percentage: used } });

  test("自分の端末のエージェントに、整数の % で記録する", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    const { id } = await core.startAgent(WT);
    expect(await core.recordContextUsageFromStatusLine(statusLine(41.6), { FAKE_AGENT: id })).toEqual({ recorded: true, used: 42 });
    expect((await core.snapshot()).tree.workspaces[0]!.worktrees.find((w) => w.path === WT)!.agents[0]!.contextUsedPercentage).toBe(42);
  });

  test("同じ % なら書かない。null（開始直後）や実行環境の外では何もしない", async () => {
    const rt = new InMemoryRuntime();
    const core = new WsCore(rt, source());
    const { id } = await core.startAgent(WT);
    await core.recordContextUsageFromStatusLine(statusLine(42), { FAKE_AGENT: id });
    expect(await core.recordContextUsageFromStatusLine(statusLine(42.2), { FAKE_AGENT: id })).toEqual({ recorded: false, reason: "unchanged" });
    expect(await core.recordContextUsageFromStatusLine(statusLine(null), { FAKE_AGENT: id })).toEqual({ recorded: false, reason: "no-context" });
    expect(await core.recordContextUsageFromStatusLine(statusLine(50), {})).toEqual({ recorded: false, reason: "not-in-runtime" });
    expect(rt.contextWrites).toBe(1);
  });
});
