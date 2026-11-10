import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

interface FakeTerminal {
  address: string;
  name: string | null;
  cwd: string;
  argv: string[];
  labels: Record<string, string>;
  parent: string | null;
  state: "live" | "finished";
  status: { state: string; kind?: string | null } | null;
  foreground: { name: string } | null;
  keep: boolean;
}
interface State {
  next: number;
  terminals: FakeTerminal[];
  docs?: Record<string, { value: unknown; version: number }>;
  log: [string, unknown][];
}

const file = process.env.FAKE_HC_STATE;
if (!file) {
  console.error("FAKE_HC_STATE is not set");
  process.exit(2);
}
const load = (): State => (existsSync(file!) ? JSON.parse(readFileSync(file!, "utf8")) : { next: 1, terminals: [], log: [] });
// 書きかけのファイルを別の hc connect が読まないよう、一時ファイルに書いてから置き換える（rename は同じフォルダー内で不可分）
const save = (s: State) => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, file!);
};

// ws ui は hc connect を 2 本つなぐ。load → 処理 → save の間に別の接続が書くと、後勝ちで更新（log や terminals）が消えるので、mkdir を排他の鍵にして 1 リクエストぶんを直列にする
const lockDir = `${file}.lock`;
function withLock<T>(fn: () => T): T {
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      // 落ちた接続が残した鍵は 5 秒で捨てる
      if (Date.now() - started > 5000) rmSync(lockDir, { recursive: true, force: true });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
const find = (s: State, ref: string) => s.terminals.find((t) => t.address === ref) ?? s.terminals.find((t) => t.name === ref && t.state === "live");

class RpcError extends Error {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message);
  }
}

function must(s: State, ref: string): FakeTerminal {
  const t = find(s, ref);
  if (!t) throw new RpcError(`no terminal ${ref}`, "not_found");
  return t;
}

function handle(s: State, method: string, p: any): unknown {
  switch (method) {
    case "terminal.list":
      return { terminals: p.all ? s.terminals : s.terminals.filter((t) => t.state === "live"), hidden_finished: 0, machines: [] };
    case "terminal.get":
      return must(s, p.terminal);
    case "terminal.run": {
      if (!/^[a-z0-9_-]{1,32}$/.test(p.name)) throw new RpcError(`invalid name: ${p.name}`, "invalid");
      if (s.terminals.some((t) => t.name === p.name && t.state === "live")) throw new RpcError(`name in use: ${p.name}`, "conflict");
      const t: FakeTerminal = {
        address: `t${s.next++}`,
        name: p.name,
        cwd: p.cwd,
        argv: p.argv,
        labels: p.labels ?? {},
        parent: null,
        state: "live",
        status: { state: "working" },
        foreground: { name: p.argv[0] },
        keep: !!p.keep,
      };
      s.terminals.push(t);
      return t;
    }
    case "terminal.label": {
      const t = must(s, p.terminal);
      for (const [k, v] of Object.entries(p.labels as Record<string, string>)) {
        if (v === "") delete t.labels[k];
        else t.labels[k] = v;
      }
      return t;
    }
    case "terminal.send": {
      const t = must(s, p.terminal);
      if (String(p.text).startsWith("claude --resume")) t.foreground = { name: "claude" };
      return {};
    }
    case "terminal.kill": {
      const t = must(s, p.terminal);
      Object.assign(t, { state: "finished", foreground: null, status: null });
      return t;
    }
    case "terminal.rm":
      must(s, p.terminal);
      s.terminals = s.terminals.filter((t) => t.address !== p.terminal);
      return {};
    case "doc.get":
      return s.docs?.[p.name] ?? { value: null, version: 0 };
    case "doc.set": {
      const current = s.docs?.[p.name]?.version ?? 0;
      if (p.version !== current) throw new RpcError(`version ${current}`, "conflict");
      s.docs = { ...s.docs, [p.name]: { value: p.value, version: current + 1 } };
      return { version: current + 1 };
    }
    case "events.subscribe":
      return { seq: 0, terminals: s.terminals };
    default:
      throw new RpcError(`method not found: ${method}`, "not_found");
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "attach") {
  console.log(`[fake-hc] attached to ${args[0]}`);
  const DETACH = 0x1c;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", (bytes: Buffer) => bytes.includes(DETACH) && process.exit(0));
  await new Promise(() => {});
} else if (cmd === "connect") {
  withLock(() => {
    const s0 = load();
    s0.log.push(["connect", null]);
    save(s0);
  });
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk);
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const req = JSON.parse(line);
      const response = withLock(() => {
        const s = load();
        s.log.push([req.method, req.params]);
        try {
          const result = handle(s, req.method, req.params ?? {});
          save(s);
          return { jsonrpc: "2.0", id: req.id, result };
        } catch (e) {
          save(s);
          const err = e as RpcError;
          return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: err.message, data: { kind: err.kind ?? "internal" } } };
        }
      });
      console.log(JSON.stringify(response));
    }
  }
} else {
  console.error(`fake-hc: ws が使うのは connect と attach だけ: ${cmd}`);
  process.exit(2);
}
