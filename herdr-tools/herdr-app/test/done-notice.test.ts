import { describe, expect, test } from "bun:test";
import { DONE_NOTICE_MS, isJustDone } from "../src/agent-board/board";

describe("isJustDone（done になってから 10 秒以内か）", () => {
  const NOW = 1_794_820_000_000;
  test("done になってから 10 秒たつまでは true", () => {
    expect(DONE_NOTICE_MS).toBe(10000);
    expect(isJustDone({ rawStatus: "done", statusMs: NOW }, NOW)).toBe(true);
    expect(isJustDone({ rawStatus: "done", statusMs: NOW - 9999 }, NOW)).toBe(true);
  });
  test("10 秒たったら false", () => {
    expect(isJustDone({ rawStatus: "done", statusMs: NOW - 10000 }, NOW)).toBe(false);
    expect(isJustDone({ rawStatus: "done", statusMs: NOW - 3_600_000 }, NOW)).toBe(false);
  });
  test("done でない状態は、変わった直後でも false", () => {
    expect(isJustDone({ rawStatus: "working", statusMs: NOW }, NOW)).toBe(false);
    expect(isJustDone({ rawStatus: "idle", statusMs: NOW }, NOW)).toBe(false);
  });
  test("状態が変わった時刻が分からなければ false", () => {
    expect(isJustDone({ rawStatus: "done", statusMs: null }, NOW)).toBe(false);
  });
});
