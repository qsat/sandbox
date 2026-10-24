import type { AgentKind } from "../types/agent.ts";

const AGENTS: [AgentKind, RegExp][] = [
  ["claude", /^claude$|@anthropic-ai\/claude-code|\/claude\/versions\//],
  ["codex", /^codex$|@openai\/codex/],
  ["aider", /^aider$/],
  ["gemini", /^gemini$|@google\/gemini-cli/],
  ["cursor", /^cursor-agent$/],
  ["copilot", /^copilot$|@github\/copilot/],
  ["opencode", /^opencode$/],
  ["amp", /^amp$|@sourcegraph\/amp/],
];
const RUNTIMES = /^(node|bun|deno|python3?(\.\d+)?|npx|uv|uvx)$/;
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
