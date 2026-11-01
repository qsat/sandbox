// AgentRuntime の herdr-core 実装（実行環境は herdr-core に一元化しているので、本番の実装はこれだけ）。
// ドメインの言葉（workspace / worktree / 会話ID / プログラム喪失）と herdr-core の言葉（ラベル / 端末名 / foreground）の翻訳はここに集める。

import { basename, type AgentRecord } from "../model";
import type { AgentRuntime, AgentStartSpec } from "../ports";
import { Hc, type HcTerminal } from "./hc";

export const LABEL_WS = "ws";
export const LABEL_WT = "wt";
/** 実機確認でラベルのキーに . が使えなければ claude_session にする（読むときは両方見る） */
export const SESSION_LABEL_CANDIDATES = ["claude.session", "claude_session"] as const;

export function sessionIdOf(labels: Record<string, string>): string | undefined {
  for (const k of SESSION_LABEL_CANDIDATES) if (labels[k]) return labels[k];
  return undefined;
}

const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);

export function isShell(name: string | undefined | null): boolean {
  if (!name) return false;
  return SHELLS.has(basename(name.replace(/^-/, "")));
}

const NAME_MAX = 32;

/**
 * core の端末名規則: 英小文字・数字・-・_ の1〜32文字、生きている端末の中で一意。
 * <repo>-<branch> を slug 化し、重複時は -2, -3 … を付ける。
 */
export function terminalNameFor(repo: string, branch: string | null | undefined, taken: Iterable<string>): string {
  const raw = branch && branch !== repo ? `${repo}-${branch}` : repo;
  let base = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  base = base.slice(0, NAME_MAX).replace(/[-_]+$/g, "") || "agent";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const cand = base.slice(0, NAME_MAX - suffix.length).replace(/[-_]+$/g, "") + suffix;
    if (!used.has(cand)) return cand;
  }
}

/** herdr-core の端末 → ws-core のエージェント */
export function toAgentRecord(t: HcTerminal): AgentRecord {
  return {
    id: t.address,
    name: t.name,
    cwd: t.cwd,
    status: t.status,
    kind: t.kind,
    msg: t.msg,
    alive: t.state === "live",
    parent: t.parent,
    workspaceHint: t.labels[LABEL_WS] || undefined,
    worktreeHint: t.labels[LABEL_WT] || undefined,
    sessionId: sessionIdOf(t.labels),
    // --keep の端末はプログラムを失うとシェルに置き換わる。foreground が無ければ分からない
    programLost: t.foreground ? isShell(t.foreground.name) : undefined,
  };
}

export interface HerdrRuntimeOptions {
  hcBin?: string;
  /** 会話IDを記録するラベルのキー */
  sessionLabel?: string;
}

export class HerdrRuntime implements AgentRuntime {
  private readonly hc: Hc;
  private readonly sessionLabel: string;

  constructor(opts: HerdrRuntimeOptions = {}) {
    this.hc = new Hc(opts.hcBin ?? "hc");
    this.sessionLabel = opts.sessionLabel ?? SESSION_LABEL_CANDIDATES[0];
  }

  async list(): Promise<AgentRecord[]> {
    return (await this.hc.list()).map(toAgentRecord);
  }

  async get(id: string): Promise<AgentRecord | undefined> {
    const t = await this.hc.get(id);
    return t ? toAgentRecord(t) : undefined;
  }

  async start(spec: AgentStartSpec): Promise<{ id: string; name: string }> {
    const live = (await this.hc.list()).filter((t) => t.state === "live");
    const name = terminalNameFor(spec.repo, spec.branch, live.map((t) => t.name));
    const out = await this.hc.run({ name, cwd: spec.worktree, labels: { [LABEL_WS]: spec.workspace, [LABEL_WT]: spec.worktree }, command: spec.command });
    // hc run の出力形式に依存しないよう、名前で引き直す（名前は生きている端末の中で一意）
    const again = await this.hc.list();
    const id = again.find((t) => t.name === name && t.state === "live")?.address ?? /^\s*(t\d+)\s*$/m.exec(out)?.[1];
    if (!id) throw new Error(`起動した端末が見つかりません: ${name}`);
    return { id, name };
  }

  async recordSession(id: string, sessionId: string): Promise<void> {
    await this.hc.label(id, this.sessionLabel, sessionId);
  }

  send(id: string, text: string): Promise<void> {
    return this.hc.send(id, text);
  }

  stop(id: string): Promise<void> {
    return this.hc.kill(id);
  }

  remove(id: string): Promise<void> {
    return this.hc.rm(id);
  }

  /** core の端末内で動くプロセスには $HC_TERMINAL_ID に自分のアドレスが入る */
  currentAgentId(env: Record<string, string | undefined>): string | undefined {
    return env.HC_TERMINAL_ID || undefined;
  }

  /** 会話に入るコマンド。切り離しは Ctrl+\ */
  attachCommand(id: string): string {
    return `${this.hc.bin} attach ${id}`;
  }

  subscribe(onChange: () => void): () => void {
    return this.hc.subscribe({}, onChange, () => {});
  }
}
