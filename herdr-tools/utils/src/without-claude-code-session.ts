const CLAUDE_CODE_SESSION_MARKERS = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
]);

export function withoutClaudeCodeSession(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !CLAUDE_CODE_SESSION_MARKERS.has(key)));
}
