import { describe, expect, test } from "bun:test";
import { normalizeTerminal } from "../../src/herdr-core/hc";
import { isShell, terminalNameFor, toAgentRecord } from "../../src/herdr-core/runtime";

describe("端末名（core の規則: 英小文字・数字・-・_ の1〜32文字）", () => {
  test("<repo>-<branch> を slug 化（= や大文字・/ は使えない）", () => {
    expect(terminalNameFor("api", "feat/Auth", [])).toBe("api-feat-auth");
    expect(terminalNameFor("api", "main", [])).toBe("api-main");
    expect(terminalNameFor("api", null, [])).toBe("api");
    expect(terminalNameFor("API.Server", "x", [])).toBe("api-server-x");
  });
  test("重複は -2, -3", () => {
    expect(terminalNameFor("api", "main", ["api-main"])).toBe("api-main-2");
    expect(terminalNameFor("api", "main", ["api-main", "api-main-2"])).toBe("api-main-3");
  });
  test("32文字以内（接尾辞込み）", () => {
    const long = "a".repeat(40);
    const n1 = terminalNameFor(long, "b", []);
    const n2 = terminalNameFor(long, "b", [n1]);
    expect(n1.length).toBeLessThanOrEqual(32);
    expect(n2.endsWith("-2")).toBe(true);
    expect(/^[a-z0-9_-]{1,32}$/.test(n2)).toBe(true);
  });
});

describe("toAgentRecord（herdr-core の言葉 → ws-core の言葉）", () => {
  const raw = {
    address: "t7",
    name: "api",
    cwd: "/x",
    labels: { ws: "/repo", wt: "/repo=feat", "claude.session": "abc" },
    state: "live",
    status: { state: "idle" },
    foreground: { name: "-zsh" },
  };
  test("ラベル → workspace / worktree / 会話ID", () => {
    expect(toAgentRecord(normalizeTerminal(raw))).toMatchObject({ id: "t7", workspaceHint: "/repo", worktreeHint: "/repo=feat", sessionId: "abc", alive: true });
  });
  test("前面がシェル → プログラム喪失（--keep の復旧）", () => {
    expect(toAgentRecord(normalizeTerminal(raw)).programLost).toBe(true);
    expect(toAgentRecord(normalizeTerminal({ ...raw, foreground: { name: "claude" } })).programLost).toBe(false);
    expect(toAgentRecord(normalizeTerminal({ ...raw, foreground: undefined })).programLost).toBeUndefined();
  });
  test("claude_session キーも読む・終了済みは alive=false", () => {
    const r = toAgentRecord(normalizeTerminal({ ...raw, state: "finished", labels: { claude_session: "s" } }));
    expect(r).toMatchObject({ sessionId: "s", alive: false });
  });
  test("isShell", () => {
    expect(isShell("/bin/bash")).toBe(true);
    expect(isShell("node")).toBe(false);
  });
});
