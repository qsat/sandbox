import { describe, expect, test } from "bun:test";
import { withoutClaudeCodeSession } from "../src/without-claude-code-session";

describe("withoutClaudeCodeSession", () => {
  test("Claude Code が子プロセスに渡すセッションの印を外し、ほかの変数は残す", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/Users/me",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_PID: "123",
      AI_AGENT: "claude-code",
      CLAUDE_CODE_USE_BEDROCK: "1",
    };
    expect(withoutClaudeCodeSession(env)).toEqual({ PATH: "/usr/bin", HOME: "/Users/me", CLAUDE_CODE_USE_BEDROCK: "1" });
  });
});
