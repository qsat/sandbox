// テスト用のスタブ hc。状態は $HC_STUB_STATE の JSON に持ち、操作は log に追記する。
// 実際の herdr-core の代わりに、ws の判断と tmux 操作を E2E で確かめるためのもの。
//
//   hc ls --json | get <t> --json | run --bg --keep --name n --cwd d --label k=v -- cmd...
//   hc label <t> k=v | send <t> text | kill <t> | rm <t> | attach <t> | connect (JSON-RPC)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface StubTerminal {
  address: string;
  name: string;
  cwd: string;
  argv: string[];
  labels: Record<string, string>;
  parent: string | null;
  state: "live" | "finished";
  status: { state: string; kind?: string };
  foreground: { name: string; argv: string[]; cwd: string };
  keep: boolean;
}
interface State {
  next: number;
  terminals: StubTerminal[];
  log: string[][];
}

const file = process.env.HC_STUB_STATE;
if (!file) {
  console.error("HC_STUB_STATE is not set");
  process.exit(2);
}

function load(): State {
  if (!existsSync(file!)) return { next: 1, terminals: [], log: [] };
  return JSON.parse(readFileSync(file!, "utf8"));
}
function save(s: State) {
  writeFileSync(file!, JSON.stringify(s, null, 2));
}
function find(s: State, ref: string) {
  return s.terminals.find((t) => t.address === ref) ?? s.terminals.find((t) => t.name === ref && t.state === "live");
}

const [cmd, ...args] = process.argv.slice(2);
const state = load();
if (cmd !== "connect") {
  state.log.push([cmd ?? "", ...args]);
  save(state);
}

switch (cmd) {
  case "ls": {
    // 実物の hc ls の行と同じく、ラベルや foreground は持たない
    console.log(JSON.stringify(state.terminals.map((t) => ({ address: t.address, name: t.name, parent: t.parent, state: t.state, cwd: t.cwd, status: t.status.state }))));
    break;
  }
  case "get": {
    const t = find(state, args[0]!);
    if (!t) {
      console.error("no such terminal");
      process.exit(1);
    }
    console.log(JSON.stringify(t));
    break;
  }
  case "run": {
    let name = "";
    let cwd = process.cwd();
    const labels: Record<string, string> = {};
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--") break;
      if (a === "--name") name = args[++i]!;
      else if (a === "--cwd") cwd = args[++i]!;
      else if (a === "--label") {
        const [k, ...v] = args[++i]!.split("=");
        labels[k!] = v.join("=");
      }
    }
    const argv = args.slice(i + 1);
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
      console.error(`invalid name: ${name}`);
      process.exit(1);
    }
    if (state.terminals.some((t) => t.name === name && t.state === "live")) {
      console.error(`name in use: ${name}`);
      process.exit(1);
    }
    const address = `t${state.next++}`;
    state.terminals.push({ address, name, cwd, argv, labels, parent: null, state: "live", status: { state: "working" }, foreground: { name: argv[0] ?? "zsh", argv, cwd }, keep: true });
    save(state);
    console.log(address);
    break;
  }
  case "label": {
    const t = find(state, args[0]!);
    if (!t) process.exit(1);
    for (const kv of args.slice(1)) {
      const [k, ...v] = kv.split("=");
      if (v.join("=") === "") delete t.labels[k!];
      else t.labels[k!] = v.join("=");
    }
    save(state);
    break;
  }
  case "send": {
    const t = find(state, args[0]!);
    if (!t) process.exit(1);
    const text = args[1] ?? "";
    if (text.startsWith("claude --resume")) t.foreground = { name: "claude", argv: text.split(" "), cwd: t.cwd };
    save(state);
    break;
  }
  case "kill": {
    const t = find(state, args[0]!);
    if (!t) process.exit(1);
    t.state = "finished";
    save(state);
    break;
  }
  case "rm": {
    state.terminals = state.terminals.filter((t) => t.address !== args[0]);
    save(state);
    break;
  }
  case "attach": {
    console.log(`[stub] attached to ${args[0]}`);
    await new Promise(() => {});
    break;
  }
  case "connect": {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of Bun.stdin.stream()) {
      buf += decoder.decode(chunk);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        const s = load();
        let result: unknown;
        if (req.method === "terminal.list") result = { terminals: s.terminals };
        else if (req.method === "terminal.get") result = find(s, req.params?.terminal);
        else if (req.method === "events.subscribe") result = { subscription: 1 };
        else {
          console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } }));
          continue;
        }
        console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
        if (req.method === "events.subscribe") console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.event", params: { type: "snapshot", terminals: s.terminals } }));
      }
    }
    break;
  }
  default:
    console.error(`stub hc: unknown command ${cmd}`);
    process.exit(2);
}
