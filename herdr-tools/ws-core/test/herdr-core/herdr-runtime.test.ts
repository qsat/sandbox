import { describe, expect, test } from "bun:test";
import type { HcTerminal } from "../../src/herdr-core/hc-terminal";
import { isAgentTerminal, isShell, toAgentRecord, uniqueTerminalName } from "../../src/herdr-core/herdr-runtime";

describe("端末名（core の規則: 英小文字・数字・-・_ の1〜32文字）", () => {
  test("<repo>-<branch> を slug 化（= や大文字・/ は使えない）", () => {
    expect(uniqueTerminalName("api", "feat/Auth", [])).toBe("api-feat-auth");
    expect(uniqueTerminalName("api", "main", [])).toBe("api-main");
    expect(uniqueTerminalName("api", null, [])).toBe("api");
    expect(uniqueTerminalName("API.Server", "x", [])).toBe("api-server-x");
  });
  test("重複は -2, -3", () => {
    expect(uniqueTerminalName("api", "main", ["api-main"])).toBe("api-main-2");
    expect(uniqueTerminalName("api", "main", ["api-main", "api-main-2"])).toBe("api-main-3");
  });
  test("32文字以内（接尾辞込み）", () => {
    const long = "a".repeat(40);
    const n1 = uniqueTerminalName(long, "b", []);
    const n2 = uniqueTerminalName(long, "b", [n1]);
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
    expect(toAgentRecord(raw, L)).toMatchObject({ id: "t7", recordedWorkspace: "/repo", recordedWorktree: "/repo=feat", claudeSessionId: "abc", alive: true, status: "blocked", blockedReason: "permission", message: "Allow?" });
  });
  test("status_ms → statusMs（取れなければ undefined）", () => {
    expect(toAgentRecord({ ...raw, status_ms: 1793788009632 }, L).statusMs).toBe(1793788009632);
    expect(toAgentRecord({ ...raw, status_ms: null }, L).statusMs).toBeUndefined();
    expect(toAgentRecord(raw, L).statusMs).toBeUndefined();
  });
  test("前面がシェル → プログラム喪失（--keep の復旧）。終了後は分からない", () => {
    expect(toAgentRecord(raw, L).programLost).toBe(true);
    expect(toAgentRecord({ ...raw, foreground: { name: "claude" } }, L).programLost).toBe(false);
    expect(toAgentRecord({ ...raw, state: "finished", foreground: null }, L)).toMatchObject({ programLost: undefined, alive: false });
  });
  test("会話IDは設定したキーだけを読み書きする", () => {
    expect(toAgentRecord(raw, "claude_sid").claudeSessionId).toBeUndefined();
    expect(toAgentRecord({ ...raw, labels: { claude_sid: "s" } }, "claude_sid").claudeSessionId).toBe("s");
  });
  test("名乗っていない状態は unknown、名前が無ければアドレス", () => {
    expect(toAgentRecord({ ...raw, status: null, name: null }, L)).toMatchObject({ status: "unknown", name: "t7" });
  });
  test("知らない状態の文字は unknown にする（並び順の先頭に紛れ込ませない）", () => {
    expect(toAgentRecord({ ...raw, status: { state: "compacting" } }, L).status).toBe("unknown");
  });
  test("isShell", () => {
    expect(isShell("/bin/bash")).toBe(true);
    expect(isShell("node")).toBe(false);
  });
});

describe("isAgentTerminal（herdr-core の端末のうち、エージェントとして一覧に出すもの）", () => {
  const L = "claude.session";
  const plainShell: HcTerminal = {
    address: "t1",
    name: null,
    cwd: "/Users/me",
    labels: { "herdr.space": "sp1", "herdr.tab": "tb1", where: "~ / 1" },
    parent: null,
    state: "live",
    status: null,
    reported: false,
    foreground: { name: "zsh" },
  };
  test("Herdr app で開いただけのシェルは出さない", () => {
    expect(isAgentTerminal(plainShell, L)).toBe(false);
  });
  test("状態を報告したことがあれば出す（いま status が無くても）", () => {
    expect(isAgentTerminal({ ...plainShell, reported: true }, L)).toBe(true);
    expect(isAgentTerminal({ ...plainShell, status: { state: "working" } }, L)).toBe(true);
  });
  test("ws new が起動した端末は、claude が落ちてシェルに戻っても出す（再開の対象）", () => {
    expect(isAgentTerminal({ ...plainShell, labels: { ws: "/repo", wt: "/repo=feat" } }, L)).toBe(true);
  });
  test("SessionStart hook が会話IDを記録した端末は出す", () => {
    expect(isAgentTerminal({ ...plainShell, labels: { [L]: "abc" } }, L)).toBe(true);
    expect(isAgentTerminal({ ...plainShell, labels: { [L]: "abc" } }, "claude_sid")).toBe(false);
  });
});

describe("toAgentRecord の context 使用率（claude.context ラベル）", () => {
  const base: HcTerminal = { address: "t9", name: "a", cwd: "/x", labels: {}, parent: null, state: "live", status: null, foreground: { name: "claude" } };
  test("数値のラベルを読む。無い・壊れた値は undefined", () => {
    expect(toAgentRecord({ ...base, labels: { "claude.context": "42" } }, "claude.session").contextUsedPercentage).toBe(42);
    expect(toAgentRecord(base, "claude.session").contextUsedPercentage).toBeUndefined();
    expect(toAgentRecord({ ...base, labels: { "claude.context": "x" } }, "claude.session").contextUsedPercentage).toBeUndefined();
  });
});
