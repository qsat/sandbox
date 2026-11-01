// herdr-core（hc）との境界。
// - 読み取りと購読は JSON-RPC（hc connect: stdin/stdout で1行1メッセージ）。ソケットのパス解決は hc に任せる
// - 一回きりの操作（run / label / send / kill / rm）は CLI
// API はプレビュー版（protocol generation 1）なので、返り値の形の揺れは normalizeTerminal で吸収する。

import type { AgentStatus, Terminal } from "../domain";
import { run, runOk } from "./exec";

export const HC_BIN = process.env.HC_BIN || "hc";

const STATUSES = new Set<AgentStatus>(["working", "blocked", "idle", "done", "error"]);

function asStatus(v: unknown): AgentStatus {
  return typeof v === "string" && STATUSES.has(v as AgentStatus) ? (v as AgentStatus) : "unknown";
}

function asLabels(v: unknown): Record<string, string> {
  if (!v) return {};
  if (Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const x of v) {
      if (typeof x !== "string") continue;
      const i = x.indexOf("=");
      if (i > 0) out[x.slice(0, i)] = x.slice(i + 1);
    }
    return out;
  }
  if (typeof v === "object") {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val != null) out[k] = String(val);
    return out;
  }
  return {};
}

/** terminal.list / terminal.get / hc ls --json / hc get --json のどれでも受ける */
export function normalizeTerminal(raw: any): Terminal {
  const st = raw?.status;
  const statusObj = st && typeof st === "object" ? st : undefined;
  const fg = raw?.foreground;
  return {
    address: String(raw?.address ?? raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    cwd: String(raw?.cwd ?? fg?.cwd ?? ""),
    labels: asLabels(raw?.labels),
    parent: raw?.parent ? String(raw.parent) : null,
    state: raw?.state === "finished" ? "finished" : "live",
    status: asStatus(statusObj ? statusObj.state : st),
    kind: statusObj?.kind ?? raw?.kind ?? undefined,
    msg: statusObj?.msg ?? undefined,
    foreground: fg && typeof fg === "object" ? { name: String(fg.name ?? ""), argv: fg.argv, cwd: fg.cwd, pid: fg.pid } : undefined,
    argv: Array.isArray(raw?.argv) ? raw.argv.map(String) : undefined,
    exitCode: raw?.exit_code ?? null,
  };
}

function terminalsFromResult(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.terminals)) return result.terminals;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

// ---------------------------------------------------------------------------
// JSON-RPC over `hc connect`
// ---------------------------------------------------------------------------

export class HcRpc {
  private proc: ReturnType<typeof Bun.spawn> | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed = false;
  onNotification: (msg: any) => void = () => {};
  onClose: () => void = () => {};

  start(): void {
    this.proc = Bun.spawn([HC_BIN, "connect"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of this.proc!.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.dispatch(line);
        }
      }
    } catch {
      // stream closed
    }
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("hc connect closed"));
    this.pending.clear();
    this.onClose();
  }

  private dispatch(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg && typeof msg.id === "number" && this.pending.has(msg.id) && !msg.method) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`hc rpc error: ${msg.error.message ?? JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
      return;
    }
    this.onNotification(msg);
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<any> {
    if (!this.proc) this.start();
    if (this.closed) return Promise.reject(new Error("hc connect closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`hc rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const sink = this.proc!.stdin as import("bun").FileSink;
      sink.write(payload);
      sink.flush();
    });
  }

  close(): void {
    try {
      (this.proc?.stdin as import("bun").FileSink | undefined)?.end();
    } catch {}
    try {
      this.proc?.kill();
    } catch {}
  }
}

async function withRpc<T>(fn: (rpc: HcRpc) => Promise<T>): Promise<T> {
  const rpc = new HcRpc();
  rpc.start();
  try {
    return await fn(rpc);
  } finally {
    rpc.close();
  }
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

/** 端末一覧。RPC が使えなければ hc ls --json にフォールバック（その場合ラベルは無いことがある） */
export async function listTerminals(): Promise<Terminal[]> {
  try {
    const result = await withRpc((rpc) => rpc.call("terminal.list", {}));
    return terminalsFromResult(result).map(normalizeTerminal).filter((t) => t.address);
  } catch {
    const r = await run(HC_BIN, ["ls", "--json"]);
    if (r.code !== 0) {
      if (r.code === 127) return []; // hc が無い
      throw new Error(`hc ls --json failed: ${r.stderr.trim()}`);
    }
    return parseJsonList(r.stdout).map(normalizeTerminal).filter((t) => t.address);
  }
}

function parseJsonList(text: string): any[] {
  const t = text.trim();
  if (!t) return [];
  try {
    return terminalsFromResult(JSON.parse(t));
  } catch {
    // JSON Lines の可能性
    return t
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);
  }
}

export async function getTerminal(ref: string): Promise<Terminal | undefined> {
  const r = await run(HC_BIN, ["get", ref, "--json"]);
  if (r.code !== 0) return undefined;
  try {
    const raw = JSON.parse(r.stdout);
    return normalizeTerminal(raw?.terminal ?? raw);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 操作（CLI）
// ---------------------------------------------------------------------------

export interface RunSpec {
  name: string;
  cwd: string;
  labels: Record<string, string>;
  command: string[];
}

export async function runTerminal(spec: RunSpec): Promise<string> {
  const args = ["run", "--bg", "--keep", "--name", spec.name, "--cwd", spec.cwd];
  for (const [k, v] of Object.entries(spec.labels)) args.push("--label", `${k}=${v}`);
  args.push("--", ...spec.command);
  return (await runOk(HC_BIN, args)).trim();
}

export async function setLabel(ref: string, key: string, value: string): Promise<void> {
  await runOk(HC_BIN, ["label", ref, `${key}=${value}`]);
}

export async function sendText(ref: string, text: string): Promise<void> {
  await runOk(HC_BIN, ["send", ref, text]);
}

export async function killTerminal(ref: string): Promise<void> {
  await runOk(HC_BIN, ["kill", ref]);
}

export async function removeTerminal(ref: string): Promise<void> {
  await runOk(HC_BIN, ["rm", ref]);
}

/** tmux のペインで動かす会話用コマンド */
export function attachCommand(address: string): string {
  return `${HC_BIN} attach ${address}`;
}

// ---------------------------------------------------------------------------
// 購読（popup の自動更新）
// ---------------------------------------------------------------------------

/**
 * events.subscribe を張り、何かイベントが来るたびに onEvent を呼ぶ。
 * 最初のスナップショット・heartbeat・missed もすべて「変化の可能性」として扱い、呼び出し側で間引く。
 */
export function subscribe(params: Record<string, unknown>, onEvent: (msg: any) => void, onClose: () => void): () => void {
  const rpc = new HcRpc();
  rpc.onNotification = (msg) => {
    const method: string = msg?.method ?? "";
    if (method.includes("heartbeat") || msg?.params?.type === "heartbeat") return;
    onEvent(msg);
  };
  rpc.onClose = onClose;
  rpc.start();
  rpc.call("events.subscribe", params, 10000).catch(() => onClose());
  return () => rpc.close();
}
