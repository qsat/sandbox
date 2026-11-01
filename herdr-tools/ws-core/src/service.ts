// ws-core のユースケース。herdr-core と git / ghq から事実を集め、木を組み、判断する。
// どのクライアント（tmux / Herdr app）から呼ばれても同じ答えを返す。

import { parseSessionStart, resumeCommand } from "./claude";
import { basename, needsResume, workspacePathFromCommonDir, type AgentNode, type Tree } from "./model";
import type { AgentRuntime, WorkspaceSource } from "./ports";
import { buildTree, collectCandidatePaths, makeLocator, planPrune, resolveRef, type Locate, type Resolved } from "./tree";

export interface CoreOptions {
  home?: string;
  /** エージェントとして起動するコマンド */
  claudeBin?: string;
  /** 再開を送ったあと、プログラムが戻るのを待つ上限 */
  resumeWaitMs?: number;
}

export interface Snapshot {
  tree: Tree;
  locate: Locate;
}

export type ResumeResult = { resumed: true; sessionId: string } | { resumed: false; reason: "not-found" | "finished" | "no-session-id" | "running" };

export type HookResult = { recorded: true } | { recorded: false; reason: "not-in-runtime" | "no-session-id" };

export class WsCore {
  private readonly claudeBin: string;

  constructor(
    readonly runtime: AgentRuntime,
    private readonly source: WorkspaceSource,
    private readonly opts: CoreOptions = {},
  ) {
    this.claudeBin = opts.claudeBin ?? "claude";
  }

  /**
   * Workspace > Worktree > Agent の木。
   * @param all     作業場所の全エントリを出す（既定はエージェントか include があるものだけ）
   * @param include クライアントが見たいパス（クライアントが開いている作業場所など）。エージェントがいなくても出す
   */
  async snapshot(opts: { all?: boolean; include?: string[] } = {}): Promise<Snapshot> {
    const root = await this.source.root();
    const [agents, entries] = await Promise.all([this.runtime.list(), this.source.entries(root)]);
    const include = opts.include ?? [];
    const infos = await this.source.inspect(collectCandidatePaths({ agents, entries, all: !!opts.all, include }));
    const tree = buildTree({ agents, infos, entries, root, home: this.opts.home, all: !!opts.all, include });
    return { tree, locate: makeLocator(tree, infos) };
  }

  resolve(snap: Snapshot, ref: string): Resolved | undefined {
    return resolveRef(snap.tree, ref);
  }

  /**
   * 要再開なら会話の再開コマンドを送る。何度呼んでも安全（対象外なら何もしない）。
   * 送ったあとはプログラムが戻るまで少し待つ（続けて会話に入ったとき素のシェルを見せないため）。
   */
  async resume(id: string): Promise<ResumeResult> {
    const a = await this.runtime.get(id);
    if (!a) return { resumed: false, reason: "not-found" };
    if (!needsResume(a)) {
      if (!a.alive) return { resumed: false, reason: "finished" };
      if (!a.sessionId) return { resumed: false, reason: "no-session-id" };
      return { resumed: false, reason: "running" };
    }
    await this.runtime.send(a.id, resumeCommand(this.claudeBin, a.sessionId!));
    const deadline = Date.now() + (this.opts.resumeWaitMs ?? 3000);
    while (Date.now() < deadline) {
      await Bun.sleep(150);
      const now = await this.runtime.get(a.id);
      if (!now || now.programLost !== true) break;
    }
    return { resumed: true, sessionId: a.sessionId! };
  }

  /** worktree でエージェントを起動する */
  async newAgent(path: string, claudeArgs: string[] = []): Promise<{ id: string; name: string }> {
    const [info] = await this.source.inspect([path]);
    if (!info?.exists) throw new Error(`ディレクトリがありません: ${path}`);
    const worktree = info.toplevel ?? path;
    const workspace = info.commonDir ? workspacePathFromCommonDir(info.commonDir) : worktree;
    return this.runtime.start({ workspace, worktree, repo: basename(workspace), branch: info.branch ?? null, command: [this.claudeBin, ...claudeArgs] });
  }

  /** Claude Code の SessionStart hook: 会話IDを実行環境に記録する */
  async recordSessionFromHook(stdin: string, env: Record<string, string | undefined>): Promise<HookResult> {
    const id = this.runtime.currentAgentId(env);
    if (!id) return { recorded: false, reason: "not-in-runtime" };
    const sessionId = parseSessionStart(stdin);
    if (!sessionId) return { recorded: false, reason: "no-session-id" };
    await this.runtime.recordSession(id, sessionId);
    return { recorded: true };
  }

  /** 場所が消えた worktree に残っているエージェント */
  prunePlan(snap: Snapshot): AgentNode[] {
    return planPrune(snap.tree);
  }

  async pruneAgents(agents: AgentNode[]): Promise<void> {
    for (const a of agents) {
      if (a.alive) await this.runtime.stop(a.id).catch(() => {});
      await this.runtime.remove(a.id).catch(() => {});
    }
  }
}
