import type { AgentKind } from "../modules/app/workspace/slice.ts";

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
  const [exe = "", ...args] = command.split(/\s+/);
  const target = RUNTIMES.test(basename(exe)) ? (args.find((a) => !a.startsWith("-")) ?? "") : exe;
  return AGENTS.find(([, re]) => re.test(target) || re.test(basename(target)))?.[0] ?? null;
}
