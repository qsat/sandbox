#!/usr/bin/env bun

import { resolve as resolvePath } from "node:path";
import { expandHome } from "@herdr-tools/utils/expand-home";
import { agentsInMissingWorktrees, looksLikePath } from "@herdr-tools/ws-core";
import { renderText, runPopup, sessionsOfMissingWorktrees, toListJson, usageLine } from "@herdr-tools/tmux";
import { composeFromEnv } from "./src/compose-from-env";

const USAGE = `ws - エージェントを workspace > worktree > agent で一覧・移動する

使い方:
  ws list [--json] [--all]                         一覧（--all で ghq の全エントリ）
  ws go <ref> [--client <name> | --from-app] [--dry-run]
                                                   移動。ref は worktree のパスかエージェントの id／名前
  ws new [<worktree>] [--here | --attach] [--client <name> | --from-app] [-- <claude の引数>]
                                                   エージェント起動。--here は今の端末で会話、--attach は agents ウィンドウへ移動
  ws resume <agent>                                再開できるなら claude --resume <id> を送る（何度呼んでも安全）
  ws stop <agent>                                  エージェントを止め、終了を待って一覧から消す
  ws close [<ref>]                                 ref（既定は今いる worktree）の tmux セッションを閉じる。エージェントは止めない
  ws panes [-a] [--pane <pane_id>] [--max <n>]     今の worktree のエージェントを agents ウィンドウに並べる
  ws ui [--client <name>]                          tmux popup 用の対話一覧
  ws hook session-start                            Claude Code の SessionStart hook
  ws statusline [--quiet]                          Claude Code の statusLine。5h / 週の利用上限を記録して表示する
  ws prune [--dry-run] [--yes]                     場所が消えた worktree のセッション・エージェントを片付ける
`;

const VALUE_FLAGS = new Set(["--client", "--pane", "--max"]);

function parseArgs(argv: string[]) {
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

type Parsed = ReturnType<typeof parseArgs>;

const str = (p: Parsed, k: string) => {
  const v = p.flags.get(k);
  return typeof v === "string" ? v : undefined;
};
const has = (p: Parsed, ...ks: string[]) => ks.some((k) => p.flags.has(k));

function absolutePathFromCwd(p: string) {
  return resolvePath(process.cwd(), expandHome(p));
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  return await new Response(Bun.stdin.stream()).text();
}

async function confirm(question: string) {
  process.stderr.write(`${question} [y/N] `);
  for await (const line of console) return /^y(es)?$/i.test(line.trim());
  return false;
}

async function main(argv: string[]) {
  const [cmd, ...restArgs] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const p = parseArgs(restArgs);
  const { core, nav } = composeFromEnv(process.env);
  const goOpts = { client: str(p, "--client"), fromApp: has(p, "--from-app") };

  switch (cmd) {
    case "list": {
      const view = await nav.view({ allEntries: has(p, "--all") });
      if (has(p, "--json")) process.stdout.write(JSON.stringify(toListJson(view.snap.tree, view.idx, view.snap.usage)) + "\n");
      else process.stdout.write(renderText(view.snap.tree, view.idx, view.snap.usage, !!process.stdout.isTTY) + "\n");
      return 0;
    }
    case "go": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws go <ref>");
      const steps = await nav.goRef(looksLikePath(ref) ? absolutePathFromCwd(ref) : ref, { ...goOpts, dryRun: has(p, "--dry-run") });
      if (has(p, "--dry-run")) process.stdout.write(JSON.stringify(steps, null, 2) + "\n");
      return 0;
    }
    case "new": {
      const path = absolutePathFromCwd(p.positional[0] ?? ".");
      if (has(p, "--here")) {
        await nav.startAgentAndTalkHere(path, p.rest);
      } else if (has(p, "--attach")) {
        await nav.startAgentAndGo(path, p.rest, goOpts);
      } else {
        const r = await core.startAgent(path, p.rest);
        process.stdout.write(`${r.id}\t${r.name}\n`);
      }
      return 0;
    }
    case "resume": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws resume <agent>");
      const r = await core.resume(ref);
      process.stdout.write(r.resumed ? `resumed ${ref} (${r.claudeSessionId})\n` : `skip ${ref}: ${r.reason}\n`);
      return r.resumed || r.reason !== "not-found" ? 0 : 1;
    }
    case "close": {
      const ref = p.positional[0] ?? ".";
      const r = await nav.closeSessionOf(looksLikePath(ref) ? absolutePathFromCwd(ref) : ref);
      process.stdout.write(r.closed ? `closed ${r.session}\n` : `skip ${ref}: ${r.reason}\n`);
      return 0;
    }
    case "stop": {
      const ref = p.positional[0];
      if (!ref) throw new Error("ws stop <agent>");
      const r = await core.stopAgent(ref);
      process.stdout.write(r.stopped ? `stopped ${ref}\n` : `skip ${ref}: ${r.reason}\n`);
      return r.stopped ? 0 : 1;
    }
    case "panes": {
      const pane = str(p, "--pane") ?? process.env.TMUX_PANE;
      if (!pane) throw new Error("--pane '#{pane_id}' を渡してください（tmux の外からは使えません）");
      const maxRaw = str(p, "--max") ?? process.env.WS_PANES_MAX;
      const r = await nav.openPanesForWorktreeOf(pane, { includeChildren: has(p, "-a", "--all"), max: maxRaw ? Number(maxRaw) : 8 });
      process.stdout.write(`ws panes: ${r.opened} 開いた / ${r.alreadyOpen} 表示済み${r.overLimit ? ` / ${r.overLimit} 上限で省略` : ""}\n`);
      return 0;
    }
    case "ui": {
      await runPopup(nav, { client: str(p, "--client") });
      return 0;
    }
    case "hook": {
      if (p.positional[0] !== "session-start") throw new Error("ws hook session-start");
      // hook の標準出力は Claude のコンテキストに入るので何も出さず、失敗しても Claude を止めない
      try {
        const r = await core.recordClaudeSessionFromHook(await readStdin(), process.env);
        if (process.env.WS_DEBUG) process.stderr.write(JSON.stringify(r) + "\n");
      } catch (e) {
        process.stderr.write(`ws hook: ${(e as Error).message}\n`);
      }
      return 0;
    }
    case "statusline": {
      const stdin = await readStdin();
      const r = await core.recordClaudeUsageFromStatusLine(stdin).catch(() => undefined);
      if (!has(p, "--quiet")) process.stdout.write(usageLine(r?.usage ?? {}, true) + "\n");
      return 0;
    }
    case "prune": {
      const view = await nav.view();
      const sessions = sessionsOfMissingWorktrees(view.snap.tree, view.idx);
      const agents = agentsInMissingWorktrees(view.snap.tree);
      if (sessions.length === 0 && agents.length === 0) {
        process.stdout.write("片付けるものはありません\n");
        return 0;
      }
      for (const s of sessions) process.stdout.write(`tmux session: ${s}\n`);
      for (const a of agents) process.stdout.write(`agent: ${a.id} ${a.name} (${a.alive ? "live" : "finished"})\n`);
      if (has(p, "--dry-run")) return 0;
      await nav.killSessions(sessions);
      if (agents.length > 0 && (has(p, "--yes", "-y") || (await confirm("上のエージェントも終了しますか")))) await core.removeAgents(agents);
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
