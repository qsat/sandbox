// AgentRuntime の herdr-core 実装（実行環境は herdr-core に一元化しているので、本番の実装はこれだけ）。
// ドメインの言葉（workspace / worktree / 会話ID / プログラム喪失）と herdr-core の言葉（ラベル / 端末名 / foreground）の翻訳はここに集める。

import { basename } from "@herdr-tools/utils/basename";
import type { AgentRecord, AgentStatus } from "../model";
import type { AgentRuntime, AgentStartSpec } from "../ports";
import { Hc } from "./hc";
import type { HcTerminal } from "./terminal";

export const LABEL_WS = "ws";
export const LABEL_WT = "wt";
/** 会話IDを記録するラベルの既定のキー（実機でキーに . が使えなければ WS_SESSION_LABEL で変える） */
export const DEFAULT_SESSION_LABEL = "claude.session";

const STATUSES = new Set(["working", "blocked", "idle", "done", "error"]);

const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);

export function isShell(name: string | undefined | null) {
  if (!name) return false;
  return SHELLS.has(basename(name.replace(/^-/, "")));
}

const NAME_MAX = 32;

/**
 * core の端末名規則: 英小文字・数字・-・_ の1〜32文字、生きている端末の中で一意。
 * <repo>-<branch> を slug 化し、重複時は -2, -3 … を付ける。
 */
export function terminalNameFor(repo: string, branch: string | null | undefined, taken: Iterable<string>) {
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

/** herdr-core の端末 → ドメインのエージェント */
export function toAgentRecord(t: HcTerminal, sessionLabel: string) {
  const state = t.status?.state;
  return {
    id: t.address,
    name: t.name ?? t.address,
    cwd: t.cwd,
    status: state && STATUSES.has(state) ? (state as AgentStatus) : "unknown",
    kind: t.status?.kind ?? undefined,
    msg: t.status?.msg || undefined,
    alive: t.state === "live",
    parent: t.parent,
    workspaceHint: t.labels[LABEL_WS] || undefined,
    worktreeHint: t.labels[LABEL_WT] || undefined,
    sessionId: t.labels[sessionLabel] || undefined,
    // --keep の端末はプログラムを失うとシェルに置き換わる（終了後は foreground が null）
    programLost: t.foreground ? isShell(t.foreground.name) : undefined,
  };
}

interface HerdrRuntimeOptions {
  hcBin?: string;
  /** 会話IDを記録するラベルのキー */
  sessionLabel?: string;
}

export class HerdrRuntime implements AgentRuntime {
  private readonly hc: Hc;
  private readonly sessionLabel: string;

  constructor(opts: HerdrRuntimeOptions = {}) {
    this.hc = new Hc(opts.hcBin ?? "hc");
    this.sessionLabel = opts.sessionLabel ?? DEFAULT_SESSION_LABEL;
  }

  async list() {
    return (await this.hc.list()).map((t) => toAgentRecord(t, this.sessionLabel));
  }

  async get(id: string) {
    const t = await this.hc.get(id);
    return t ? toAgentRecord(t, this.sessionLabel) : undefined;
  }

  async start(spec: AgentStartSpec): Promise<{ id: string; name: string }> {
    const taken = (await this.hc.list()).flatMap((t) => (t.state === "live" && t.name ? [t.name] : []));
    const name = terminalNameFor(spec.repo, spec.branch, taken);
    const id = await this.hc.run({ name, cwd: spec.worktree, labels: { [LABEL_WS]: spec.workspace, [LABEL_WT]: spec.worktree }, argv: spec.command });
    return { id, name };
  }

  async recordSession(id: string, sessionId: string) {
    await this.hc.label(id, { [this.sessionLabel]: sessionId });
  }

  send(id: string, text: string) {
    return this.hc.send(id, text);
  }

  stop(id: string) {
    return this.hc.kill(id);
  }

  remove(id: string) {
    return this.hc.rm(id);
  }

  /** core の端末内で動くプロセスには $HC_TERMINAL_ID に自分のアドレスが入る */
  currentAgentId(env: Record<string, string | undefined>) {
    return env.HC_TERMINAL_ID || undefined;
  }

  /** 会話に入るコマンド。切り離しは Ctrl+\ */
  attachCommand(id: string) {
    return `${this.hc.bin} attach ${id}`;
  }

  subscribe(onChange: () => void): () => void {
    return this.hc.subscribe(onChange);
  }
}
