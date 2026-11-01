// herdr-core（hc）の JSON-RPC クライアント。`hc connect` の stdin/stdout に1行1メッセージ（plain mode）で話す。
// 形は schema/hc.openrpc.json のとおり。接続はプロセスの中で1本を使い回し、切れたら次の呼び出しで張り直す。

import type { HcTerminal } from "./terminal";

class Connection {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  closed = false;

  constructor(bin: string, onNotification: (msg: { method: string; params?: any }) => void = () => {}) {
    this.proc = Bun.spawn([bin, "connect"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    void this.read(onNotification);
  }

  private async read(onNotification: (msg: { method: string; params?: any }) => void): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { kind: msg.error.data?.kind }));
            else p.resolve(msg.result);
          } else if (msg.method) onNotification(msg);
        }
      }
    } catch {
      // 切れた
    }
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("hc connect closed"));
    this.pending.clear();
  }

  call(method: string, params: Record<string, unknown>): Promise<any> {
    if (this.closed) return Promise.reject(new Error("hc connect closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const sink = this.proc.stdin as import("bun").FileSink;
      sink.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      sink.flush();
    });
  }

  close(): void {
    try {
      (this.proc.stdin as import("bun").FileSink).end();
      this.proc.kill();
    } catch {}
  }
}

export interface HcRunSpec {
  name: string;
  cwd: string;
  labels: Record<string, string>;
  argv: string[];
}

export class Hc {
  private conn?: Connection;

  constructor(readonly bin = "hc") {}

  private call(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.conn || this.conn.closed) this.conn = new Connection(this.bin);
    return this.conn.call(method, params);
  }

  /** 終了済みも含めて全部 */
  async list(): Promise<HcTerminal[]> {
    return (await this.call("terminal.list", { all: true })).terminals;
  }

  async get(terminal: string): Promise<HcTerminal | undefined> {
    try {
      return await this.call("terminal.get", { terminal });
    } catch (e) {
      if ((e as { kind?: string }).kind === "not_found") return undefined;
      throw e;
    }
  }

  /** --keep で、待たずに起動する。アドレスを返す */
  async run(spec: HcRunSpec): Promise<string> {
    const r = await this.call("terminal.run", { ...spec, keep: true, wait: false });
    return r.address;
  }

  async label(terminal: string, labels: Record<string, string>): Promise<void> {
    await this.call("terminal.label", { terminal, labels });
  }

  async send(terminal: string, text: string): Promise<void> {
    await this.call("terminal.send", { terminal, text });
  }

  async kill(terminal: string): Promise<void> {
    await this.call("terminal.kill", { terminal });
  }

  async rm(terminal: string): Promise<void> {
    await this.call("terminal.rm", { terminal });
  }

  /**
   * events.subscribe（plain mode では、その接続は以後通知だけを運ぶので専用の接続を張る）。
   * event と missed のたびに onChange を呼ぶ（heartbeat は除く）。
   */
  subscribe(onChange: () => void): () => void {
    let conn: Connection;
    try {
      conn = new Connection(this.bin, (msg) => {
        if (msg.method === "event" || msg.method === "missed") onChange();
      });
    } catch {
      return () => {};
    }
    conn.call("events.subscribe", {}).catch(() => {});
    return () => conn.close();
  }
}
