import { describe, expect, test } from "bun:test";
import { agentTags } from "../src/agent-tags";
import { shellQuote } from "../src/shell-quote";
import { statusIcon } from "../src/status-icon";
import { statusLabel } from "../src/status-label";
import { worktreeTags } from "../src/worktree-tags";

describe("表示の部品", () => {
  test("statusIcon / statusLabel", () => {
    expect(statusIcon("blocked")).toBe("▲");
    expect(statusIcon("unknown")).toBe("?");
    expect(statusLabel({ status: "blocked", blockedReason: "permission" })).toBe("blocked(permission)");
    expect(statusLabel({ status: "idle", blockedReason: "x" })).toBe("idle");
  });
  test("agentTags: attach の有無が分からなければ未attach を出さない", () => {
    const a = { needsResume: true, missingLocation: true, parent: "t1", alive: false };
    expect(agentTags(a, false).map((t) => t.text)).toEqual(["要再開", "未attach", "場所消失", "子:t1", "終了"]);
    expect(agentTags(a).map((t) => t.text)).toEqual(["要再開", "場所消失", "子:t1", "終了"]);
  });
  test("worktreeTags", () => {
    expect(worktreeTags({ branch: "main", exists: false }, { attached: true }).map((t) => t.text)).toEqual(["[main]", "tmux*", "場所消失"]);
    expect(worktreeTags({ branch: null, exists: true }, null)).toEqual([]);
  });
  test("shellQuote", () => {
    expect(shellQuote("abc-1")).toBe("abc-1");
    expect(shellQuote("a'b c")).toBe(`'a'\\''b c'`);
  });
});
