import type { AgentKind } from "../types/agent.ts";

/** 見つけるエージェント: 応答状況が分かる claude と、一覧に出す codex */
const AGENTS: [AgentKind, RegExp][] = [
  ["claude", /^claude$|@anthropic-ai\/claude-code|\/claude\/versions\//],
  ["codex", /^codex$|@openai\/codex/],
];
const RUNTIMES = /^(node|bun|deno|npx)$/;
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 実行ファイル名でエージェントを判定する。node 等のランタイム経由ならスクリプトのパスで判定 */
export function detectAgent(command: string): AgentKind | null {
  const target = scriptOf(command);
  return AGENTS.find(([, re]) => re.test(target) || re.test(basename(target)))?.[0] ?? null;
}

/** 実行したもの: ランタイム経由ならスクリプトのパス、そうでなければ実行ファイル */
function scriptOf(command: string): string {
  const [exe = "", ...args] = command.split(/\s+/);
  if (!RUNTIMES.test(basename(exe))) return exe;
  return args.find((a) => !a.startsWith("-")) ?? "";
}
