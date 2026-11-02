import { withoutClaudeCodeSession } from "@herdr-tools/utils/without-claude-code-session";
import type { HcTerminal } from "./hc-terminal";

type Notification = { method: string; params?: unknown };

class HcConnection {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  closed = false;

  constructor(bin: string, onNotification: (n: Notification) => void = () => {}) {
    this.proc = Bun.spawn([bin, "connect"], { stdin: "pipe", stdout: "pipe", stderr: "ignore", env: withoutClaudeCodeSession(process.env) });
    void this.readLines(onNotification);
  }

  private async readLines(onNotification: (n: Notification) => void) {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.dispatch(JSON.parse(line), onNotification);
        }
      }
    } catch {}
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("hc connect closed"));
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
      const sink = this.proc.stdin as import("bun").FileSink;
      sink.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      sink.flush();
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
