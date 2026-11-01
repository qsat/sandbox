// ws-core のユースケース。herdr-core と git / ghq から事実を集め、木を組み、判断する。
// どのクライアント（tmux / Herdr app）から呼ばれても同じ答えを返す。

import { parseSessionStart, resumeCommand } from "./claude";
import { basename } from "@herdr-tools/utils/basename";
import { needsResume, workspacePathFromCommonDir, type AgentNode } from "./model";
import type { AgentRuntime, WorkspaceSource } from "./ports";
import { buildTree, collectCandidatePaths, makeLocator } from "./tree";

interface CoreOptions {
  home?: string;
  /** エージェントとして起動するコマンド */
  claudeBin?: string;
  /** 再開を送ったあと、プログラムが戻るのを待つ上限 */
  resumeWaitMs?: number;
}

export class WsCore {
  private readonly claudeBin: string;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly source: WorkspaceSource,
    private readonly opts: CoreOptions = {},
  ) {
    this.claudeBin = opts.claudeBin ?? "claude";
  }

  /**
   * Workspace > Worktree > Agent の木。
   * @param all     作業場所の全エントリも出す（既定はエージェントか include があるものだけ。全エントリはこのときだけ取る）
   * @param include クライアントが見たいパス（クライアントが開いている作業場所など）。エージェントがいなくても出す
   */
  async snapshot(opts: { all?: boolean; include?: string[] } = {}) {
    const root = await this.source.root();
    const [agents, entries] = await Promise.all([this.runtime.list(), opts.all ? this.source.entries(root) : []]);
    const include = [...(opts.include ?? []), ...entries];
    const infos = await this.source.inspect(collectCandidatePaths(agents, include));
    const tree = buildTree({ agents, infos, include, root, home: this.opts.home });
    return { tree, locate: makeLocator(tree, infos) };
  }

  /** 会話に入るためのコマンド（クライアントが自分の端末で実行する） */
  attachCommand(id: string) {
    return this.runtime.attachCommand(id);
  }

  /** エージェントに変化があるたびに onChange を呼ぶ。戻り値で購読をやめる */
  subscribe(onChange: () => void): () => void {
    return this.runtime.subscribe(onChange);
  }

  /**
   * 要再開なら会話の再開コマンドを送る。何度呼んでも安全（対象外なら何もしない）。
   * 送ったあとはプログラムが戻るまで少し待つ（続けて会話に入ったとき素のシェルを見せないため）。
   */
  async resume(id: string) {
    const a = await this.runtime.get(id);
    if (!a) return { resumed: false, reason: "not-found" } as const;
    if (!needsResume(a)) {
      if (!a.alive) return { resumed: false, reason: "finished" } as const;
      if (!a.sessionId) return { resumed: false, reason: "no-session-id" } as const;
      return { resumed: false, reason: "running" } as const;
    }
    await this.runtime.send(a.id, resumeCommand(this.claudeBin, a.sessionId!));
    const deadline = Date.now() + (this.opts.resumeWaitMs ?? 3000);
    while (Date.now() < deadline) {
      await Bun.sleep(150);
      const now = await this.runtime.get(a.id);
      if (!now || now.programLost !== true) break;
    }
    return { resumed: true, sessionId: a.sessionId! } as const;
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
  async recordSessionFromHook(stdin: string, env: Record<string, string | undefined>) {
    const id = this.runtime.currentAgentId(env);
    if (!id) return { recorded: false, reason: "not-in-runtime" } as const;
    const sessionId = parseSessionStart(stdin);
    if (!sessionId) return { recorded: false, reason: "no-session-id" } as const;
    await this.runtime.recordSession(id, sessionId);
    return { recorded: true } as const;
  }

  /** 場所が消えた worktree に残っていたエージェント（planPrune の結果）を止めて消す */
  async pruneAgents(agents: AgentNode[]) {
    for (const a of agents) {
      if (a.alive) await this.runtime.stop(a.id).catch(() => {});
      await this.runtime.remove(a.id).catch(() => {});
    }
  }
}
