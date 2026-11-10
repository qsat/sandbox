import { withoutClaudeCodeSession } from "@herdr-tools/utils/without-claude-code-session";
import type { HcTerminal } from "./hc-terminal";

type Notification = { method: string; params?: unknown };

/** 切れた理由として残す標準エラーの長さ（末尾だけ） */
const STDERR_TAIL = 2000;

/** ストリームの末尾だけを覚えながら最後まで読む（hc connect の標準エラーを溜め込まない） */
async function tailOf(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let tail = "";
  try {
    for await (const chunk of stream) tail = (tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL);
  } catch {}
  return tail;
}

/** JSON-RPC の 1 行を読む。JSON でない行（hc が標準出力に混ぜた警告など）は捨て、接続は切らない */
function parseMessage(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function lastLine(text: string) {
  return text.trim().split("\n").at(-1)?.trim() ?? "";
}

class HcConnection {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  closed = false;

  constructor(bin: string, onNotification: (n: Notification) => void = () => {}) {
    this.proc = Bun.spawn([bin, "connect"], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: withoutClaudeCodeSession(process.env) });
    void this.readLines(onNotification, tailOf(this.proc.stderr as ReadableStream<Uint8Array>));
  }

  private async readLines(onNotification: (n: Notification) => void, stderr: Promise<string>) {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const msg = line ? parseMessage(line) : undefined;
          if (msg) this.dispatch(msg, onNotification);
        }
      }
    } catch {}
    this.closed = true;
    // hc connect が理由を標準エラーに出して終わったとき（herdr-core が動いていないなど）、その最後の行を添える
    const reason = lastLine(await Promise.race([stderr, Bun.sleep(200).then(() => "")]));
    for (const p of this.pending.values()) p.reject(new Error(reason ? `hc connect closed: ${reason}` : "hc connect closed"));
    this.pending.clear();
  }

  private dispatch(msg: any, onNotification: (n: Notification) => void) {
    const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!p) return msg.method && onNotification(msg);
    this.pending.delete(msg.id);
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { kind: msg.error.data?.kind }));
    else p.resolve(msg.result);
  }

  call<T>(method: string, params: Record<string, unknown>) {
    if (this.closed) return Promise.reject(new Error("hc connect closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // 書けない（hc connect が先に終わった）ときは EPIPE をそのまま出さず、読み取り側が理由を添えて reject するのに任せる
      const giveUp = () => this.close();
      try {
        const sink = this.proc.stdin as import("bun").FileSink;
        sink.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        void Promise.resolve(sink.flush()).catch(giveUp);
      } catch {
        giveUp();
      }
    });
  }

  close() {
    try {
      (this.proc.stdin as import("bun").FileSink).end();
      this.proc.kill();
    } catch {}
  }
}

export class HcClient {
  private conn?: HcConnection;

  constructor(readonly bin = "hc") {}

  private call<Result = unknown>(method: string, params: Record<string, unknown>) {
    if (!this.conn || this.conn.closed) this.conn = new HcConnection(this.bin);
    return this.conn.call<Result>(method, params);
  }

  async listIncludingFinished() {
    return (await this.call<{ terminals: HcTerminal[] }>("terminal.list", { all: true })).terminals;
  }

  async get(terminal: string) {
    try {
      return await this.call<HcTerminal>("terminal.get", { terminal });
    } catch (e) {
      if ((e as { kind?: string }).kind === "not_found") return undefined;
      throw e;
    }
  }

  async runKeptInBackground(spec: { name: string; cwd: string; labels: Record<string, string>; argv: string[] }) {
    return (await this.call<HcTerminal>("terminal.run", { ...spec, keep: true, wait: false })).address;
  }

  async label(terminal: string, labels: Record<string, string>) {
    await this.call("terminal.label", { terminal, labels });
  }

  async send(terminal: string, text: string) {
    await this.call("terminal.send", { terminal, text });
  }

  async kill(terminal: string) {
    await this.call("terminal.kill", { terminal });
  }

  async rm(terminal: string) {
    await this.call("terminal.rm", { terminal });
  }

  async docGet(name: string) {
    return this.call<{ value: unknown; version: number }>("doc.get", { name });
  }

  async docSet(name: string, value: unknown, version: number) {
    await this.call("doc.set", { name, value, version });
  }

  subscribe(onChange: () => void) {
    let conn: HcConnection;
    try {
      // plain mode では events.subscribe した接続が以後通知だけを運ぶので、専用の接続を張る
      conn = new HcConnection(this.bin, (n) => (n.method === "event" || n.method === "missed") && onChange());
    } catch {
      return () => {};
    }
    conn.call("events.subscribe", {}).catch(() => {});
    return () => conn.close();
  }
}
