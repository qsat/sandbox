import { describe, expect, test } from "bun:test";
import { normalizeTerminal } from "../../src/herdr-core/hc";

describe("normalizeTerminal", () => {
  test("terminal.get 形式（status がオブジェクト、labels がオブジェクト）", () => {
    const t = normalizeTerminal({
      address: "t7",
      name: "api",
      cwd: "/x",
      labels: { ws: "/x", "claude.session": "abc" },
      parent: null,
      state: "live",
      status: { state: "blocked", kind: "permission", msg: "Allow?" },
      foreground: { pid: 1, name: "zsh", argv: ["zsh"], cwd: "/x" },
      exit_code: null,
    });
    expect(t).toMatchObject({ address: "t7", status: "blocked", kind: "permission", msg: "Allow?", foreground: { name: "zsh" } });
    expect(t.labels["claude.session"]).toBe("abc");
  });

  test("hc ls --json の行形式（status は単語、ラベル無し）", () => {
    const t = normalizeTerminal({ address: "t1", name: "a", parent: "t0", state: "finished", cwd: "/y", status: "done", exit_code: 0 });
    expect(t).toMatchObject({ address: "t1", parent: "t0", state: "finished", status: "done", labels: {} });
    expect(t.foreground).toBeUndefined();
  });

  test("ラベルが k=v の配列でも読む・未知の状態は unknown", () => {
    const t = normalizeTerminal({ address: "t2", labels: ["wt=/a", "x=1=2"], status: "weird" });
    expect(t.labels).toEqual({ wt: "/a", x: "1=2" });
    expect(t.status).toBe("unknown");
  });
});
