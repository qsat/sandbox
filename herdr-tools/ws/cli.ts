#!/usr/bin/env bun
// ws: herdr-core × tmux のナビゲーション CLI。
// 「読む（list）」と「動かす（go / new / resume / panes）」だけを持つ。判断は domain.ts に、外部 I/O は infra/ に。

import * as app from "./src/app";
import { renderText } from "./src/ui/view";

const USAGE = `ws - herdr-core のエージェントを workspace > worktree > agent で一覧・移動する

使い方:
  ws list [--json] [--all]                         一覧（--all で ghq の全エントリ）
  ws go <ref> [--client <name> | --from-app] [--dry-run]
                                                   移動。ref は worktree のパスかエージェントのアドレス
  ws new [<worktree>] [--attach] [--client <name> | --from-app] [-- <claude の引数>]
                                                   エージェント起動（hc run --bg --keep）
  ws resume <agent>                                要再開なら claude --resume <id> を送る（何度呼んでも安全）
  ws panes [-a] [--pane <pane_id>] [--max <n>]     今の worktree のエージェントを agents ウィンドウに並べる
  ws ui [--client <name>]                          tmux popup 用の対話一覧
  ws hook session-start                            Claude Code の SessionStart hook
  ws prune [--dry-run] [--yes]                     場所が消えた worktree のセッション・エージェントを片付ける
`;

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
  rest: string[];
}

const VALUE_FLAGS = new Set(["--client", "--pane", "--max"]);

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  let rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--") && a.includes("=")) {
      const [k, ...v] = a.split("=");
      flags.set(k!, v.join("="));
    } else if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} には値が必要です`);
      flags.set(a, v);
    } else if (a.startsWith("-") && a.length > 1) {
      flags.set(a, true);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, rest };
}

const str = (p: Parsed, k: string): string | undefined => {
  const v = p.flags.get(k);
  return typeof v === "string" ? v : undefined;
};
const has = (p: Parsed, ...ks: string[]) => ks.some((k) => p.flags.has(k));

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Response(Bun.stdin.stream()).text();
}

async function confirm(question: string): Promise<boolean> {
  process.stderr.write(`${question} [y/N] `);
  for await (const line of console) return /^y(es)?$/i.test(line.trim());
  return false;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...restArgs] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const p = parseArgs(restArgs);
  const fromApp = has(p, "--from-app");
  const client = str(p, "--client");

  switch (cmd) {
    case "list": {
      const tree = await app.list({ all: has(p, "--all") });
      if (has(p, "--json")) process.stdout.write(JSON.stringify(tree) + "\n");
      else process.stdout.write(renderText(tree, !!process.stdout.isTTY) + "\n");
      return 0;
    }
    case "go": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws go <ref>");
      const steps = await app.go(ref, { client, fromApp, dryRun: has(p, "--dry-run") });
      if (has(p, "--dry-run")) process.stdout.write(JSON.stringify(steps, null, 2) + "\n");
      return 0;
    }
    case "new": {
      const r = await app.newAgent(p.positional[0], { attach: has(p, "--attach"), client, fromApp, claudeArgs: p.rest });
      if (!has(p, "--attach")) process.stdout.write(`${r.address}\t${r.name}\n`);
      return 0;
    }
    case "resume": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws resume <agent>");
      const r = await app.resume(ref);
      process.stdout.write(r.resumed ? `resumed ${ref} (${r.sessionId})\n` : `skip ${ref}: ${r.reason}\n`);
      return r.resumed || r.reason !== "not-found" ? 0 : 1;
    }
    case "panes": {
      const maxRaw = str(p, "--max");
      const r = await app.panes({ pane: str(p, "--pane"), all: has(p, "-a", "--all"), max: maxRaw ? Number(maxRaw) : undefined });
      const msg = `ws panes: ${r.opened.length} 開いた / ${r.alreadyAttached} 表示済み${r.skipped.length ? ` / ${r.skipped.length} 上限で省略` : ""}`;
      process.stdout.write(msg + "\n");
      return 0;
    }
    case "ui": {
      const { runUi } = await import("./src/ui/popup");
      await runUi({ client });
      return 0;
    }
    case "hook": {
      if (p.positional[0] !== "session-start") throw new Error("ws hook session-start");
      try {
        const r = await app.hookSessionStart(await readStdin());
        if (process.env.WS_DEBUG) process.stderr.write(JSON.stringify(r) + "\n");
      } catch (e) {
        // hook の失敗で Claude を止めない
        process.stderr.write(`ws hook: ${(e as Error).message}\n`);
      }
      return 0;
    }
    case "prune": {
      const plan = await app.prunePlan();
      if (plan.sessions.length === 0 && plan.agents.length === 0) {
        process.stdout.write("片付けるものはありません\n");
        return 0;
      }
      for (const s of plan.sessions) process.stdout.write(`tmux session: ${s}\n`);
      for (const a of plan.agents) process.stdout.write(`agent: ${a.address} ${a.name} (${a.state})\n`);
      if (has(p, "--dry-run")) return 0;
      const killAgents = plan.agents.length === 0 || has(p, "--yes", "-y") || (await confirm("上のエージェントも終了しますか"));
      await app.pruneApply(plan, { agents: killAgents && plan.agents.length > 0 });
      return 0;
    }
    default:
      process.stderr.write(`不明なコマンド: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`ws: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
