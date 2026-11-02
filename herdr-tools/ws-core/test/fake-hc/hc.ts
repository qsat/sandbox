import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
  log: [string, unknown][];
}

const file = process.env.FAKE_HC_STATE;
if (!file) {
  console.error("FAKE_HC_STATE is not set");
  process.exit(2);
}
const load = (): State => (existsSync(file!) ? JSON.parse(readFileSync(file!, "utf8")) : { next: 1, terminals: [], log: [] });
const save = (s: State) => writeFileSync(file!, JSON.stringify(s, null, 2));
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
    case "events.subscribe":
      return { seq: 0, terminals: s.terminals };
    default:
      throw new RpcError(`method not found: ${method}`, "not_found");
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "attach") {
  console.log(`[fake-hc] attached to ${args[0]}`);
  await new Promise(() => {});
} else if (cmd === "connect") {
  const s0 = load();
  s0.log.push(["connect", null]);
  save(s0);
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk);
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const req = JSON.parse(line);
      const s = load();
      s.log.push([req.method, req.params]);
      try {
        const result = handle(s, req.method, req.params ?? {});
        save(s);
        console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
      } catch (e) {
        save(s);
        const err = e as RpcError;
        console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: err.message, data: { kind: err.kind ?? "internal" } } }));
      }
    }
  }
} else {
  console.error(`fake-hc: ws が使うのは connect と attach だけ: ${cmd}`);
  process.exit(2);
}
