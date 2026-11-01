#!/usr/bin/env bun
// ws: エージェントを workspace > worktree > agent で一覧・移動する CLI。
// 判断と herdr-core の扱いは ws-core に、tmux での移動と表示は tmux/ にある。ここはつなぐだけ。

import { resolve as resolvePath } from "node:path";
import { expandHome, looksLikePath } from "@herdr-tools/ws-core";
import { renderText, runUi, withTmux } from "@herdr-tools/tmux";
import { compose } from "./src/compose";

const USAGE = `ws - エージェントを workspace > worktree > agent で一覧・移動する

使い方:
  ws list [--json] [--all]                         一覧（--all で ghq の全エントリ）
  ws go <ref> [--client <name> | --from-app] [--dry-run]
                                                   移動。ref は worktree のパスかエージェントの id／名前
  ws new [<worktree>] [--attach] [--client <name> | --from-app] [-- <claude の引数>]
                                                   エージェント起動
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

/** カレントディレクトリ基準の絶対パス（~ も展開） */
function absPath(p: string): string {
  return resolvePath(process.cwd(), expandHome(p));
}

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
  const { core, nav } = compose();
  const goOpts = { client: str(p, "--client"), fromApp: has(p, "--from-app") };

  switch (cmd) {
    case "list": {
      const view = await nav.view({ all: has(p, "--all") });
      if (has(p, "--json")) process.stdout.write(JSON.stringify(withTmux(view.snap.tree, view.idx)) + "\n");
      else process.stdout.write(renderText(view.snap.tree, view.idx, !!process.stdout.isTTY) + "\n");
      return 0;
    }
    case "go": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws go <ref>");
      const steps = await nav.goRef(looksLikePath(ref) ? absPath(ref) : ref, { ...goOpts, dryRun: has(p, "--dry-run") });
      if (has(p, "--dry-run")) process.stdout.write(JSON.stringify(steps, null, 2) + "\n");
      return 0;
    }
    case "new": {
      const path = absPath(p.positional[0] ?? ".");
      if (has(p, "--attach")) {
        await nav.newAndGo(path, p.rest, goOpts);
      } else {
        const r = await core.newAgent(path, p.rest);
        process.stdout.write(`${r.id}\t${r.name}\n`);
      }
      return 0;
    }
    case "resume": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws resume <agent>");
      const r = await core.resume(ref);
      process.stdout.write(r.resumed ? `resumed ${ref} (${r.sessionId})\n` : `skip ${ref}: ${r.reason}\n`);
      return r.resumed || r.reason !== "not-found" ? 0 : 1;
    }
    case "panes": {
      const pane = str(p, "--pane") ?? process.env.TMUX_PANE;
      if (!pane) throw new Error("--pane '#{pane_id}' を渡してください（tmux の外からは使えません）");
      const maxRaw = str(p, "--max") ?? process.env.WS_PANES_MAX;
      const r = await nav.panes(pane, { includeChildren: has(p, "-a", "--all"), max: maxRaw ? Number(maxRaw) : 8 });
      process.stdout.write(`ws panes: ${r.opened.length} 開いた / ${r.alreadyAttached} 表示済み${r.skipped.length ? ` / ${r.skipped.length} 上限で省略` : ""}\n`);
      return 0;
    }
    case "ui": {
      await runUi(nav, { client: str(p, "--client") });
      return 0;
    }
    case "hook": {
      if (p.positional[0] !== "session-start") throw new Error("ws hook session-start");
      // hook の標準出力は Claude のコンテキストに入るので何も出さない。失敗しても Claude を止めない
      try {
        const r = await core.recordSessionFromHook(await readStdin(), process.env);
        if (process.env.WS_DEBUG) process.stderr.write(JSON.stringify(r) + "\n");
      } catch (e) {
        process.stderr.write(`ws hook: ${(e as Error).message}\n`);
      }
      return 0;
    }
    case "prune": {
      const view = await nav.view();
      const sessions = nav.prunePlan(view);
      const agents = core.prunePlan(view.snap);
      if (sessions.length === 0 && agents.length === 0) {
        process.stdout.write("片付けるものはありません\n");
        return 0;
      }
      for (const s of sessions) process.stdout.write(`tmux session: ${s}\n`);
      for (const a of agents) process.stdout.write(`agent: ${a.id} ${a.name} (${a.alive ? "live" : "finished"})\n`);
      if (has(p, "--dry-run")) return 0;
      await nav.killSessions(sessions);
      if (agents.length > 0 && (has(p, "--yes", "-y") || (await confirm("上のエージェントも終了しますか")))) await core.pruneAgents(agents);
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
