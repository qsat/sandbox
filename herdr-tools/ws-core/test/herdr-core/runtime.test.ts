import { describe, expect, test } from "bun:test";
import type { HcTerminal } from "../../src/herdr-core/terminal";
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

describe("toAgentRecord（herdr-core の言葉 → ドメインの言葉）", () => {
  const raw: HcTerminal = {
    address: "t7",
    name: "api",
    cwd: "/x",
    labels: { ws: "/repo", wt: "/repo=feat", "claude.session": "abc" },
    parent: null,
    state: "live",
    status: { state: "blocked", kind: "permission", msg: "Allow?" },
    foreground: { name: "-zsh" },
  };
  const L = "claude.session";
  test("ラベル → workspace / worktree / 会話ID、status → 状態", () => {
    expect(toAgentRecord(raw, L)).toMatchObject({ id: "t7", workspaceHint: "/repo", worktreeHint: "/repo=feat", sessionId: "abc", alive: true, status: "blocked", kind: "permission", msg: "Allow?" });
  });
  test("前面がシェル → プログラム喪失（--keep の復旧）。終了後は分からない", () => {
    expect(toAgentRecord(raw, L).programLost).toBe(true);
    expect(toAgentRecord({ ...raw, foreground: { name: "claude" } }, L).programLost).toBe(false);
    expect(toAgentRecord({ ...raw, state: "finished", foreground: null }, L)).toMatchObject({ programLost: undefined, alive: false });
  });
  test("会話IDは設定したキーだけを読み書きする", () => {
    expect(toAgentRecord(raw, "claude_sid").sessionId).toBeUndefined();
    expect(toAgentRecord({ ...raw, labels: { claude_sid: "s" } }, "claude_sid").sessionId).toBe("s");
  });
  test("名乗っていない状態は unknown、名前が無ければアドレス", () => {
    expect(toAgentRecord({ ...raw, status: null, name: null }, L)).toMatchObject({ status: "unknown", name: "t7" });
  });
  test("isShell", () => {
    expect(isShell("/bin/bash")).toBe(true);
    expect(isShell("node")).toBe(false);
  });
});
