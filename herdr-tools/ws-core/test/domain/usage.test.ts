import { describe, expect, test } from "bun:test";
import { contextUsedPercentageFromStatusLine, usageFromStatusLine } from "../../src/claude-code";
import { openWindows, sameUsage } from "../../src/domain/usage";

const NOW = 1_800_000_000;
const fiveHour = { usedPercentage: 23.5, resetsAtEpochSec: NOW + 3600 };
const sevenDay = { usedPercentage: 41.2, resetsAtEpochSec: NOW + 86400 };

describe("statusLine の rate_limits から利用量を取る", () => {
  test("5h と 7d の両方", () => {
    const stdin = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: NOW + 3600 }, seven_day: { used_percentage: 41.2, resets_at: NOW + 86400 } } });
    expect(usageFromStatusLine(stdin)).toEqual({ fiveHour, sevenDay });
  });
  test("片方だけでも取る", () => {
    expect(usageFromStatusLine(JSON.stringify({ rate_limits: { seven_day: { used_percentage: 41.2, resets_at: NOW + 86400 } } }))).toEqual({ sevenDay });
  });
  test("rate_limits が無い（API アカウント、最初の応答の前）・壊れた入力は undefined", () => {
    expect(usageFromStatusLine(JSON.stringify({ model: { id: "x" } }))).toBeUndefined();
    expect(usageFromStatusLine("oops")).toBeUndefined();
  });
});

describe("openWindows", () => {
  test("リセット時刻を過ぎた枠は落とす", () => {
    expect(openWindows({ fiveHour: { ...fiveHour, resetsAtEpochSec: NOW }, sevenDay }, NOW)).toEqual({ sevenDay });
  });
  test("記録が無ければ空", () => expect(openWindows(undefined, NOW)).toEqual({}));
});

describe("sameUsage", () => {
  test("値が同じなら書き直さない", () => {
    expect(sameUsage({ fiveHour, sevenDay }, { fiveHour, sevenDay })).toBe(true);
    expect(sameUsage({ fiveHour, sevenDay }, { fiveHour: { ...fiveHour, usedPercentage: 24 }, sevenDay })).toBe(false);
    expect(sameUsage(undefined, { fiveHour })).toBe(false);
  });
});

describe("statusLine の context_window から context 使用率を取る", () => {
  test("整数に丸め、0〜100 に収める", () => {
    expect(contextUsedPercentageFromStatusLine(JSON.stringify({ context_window: { used_percentage: 41.6 } }))).toBe(42);
    expect(contextUsedPercentageFromStatusLine(JSON.stringify({ context_window: { used_percentage: 120 } }))).toBe(100);
  });
  test("null（開始直後）・無い・壊れた入力は undefined", () => {
    expect(contextUsedPercentageFromStatusLine(JSON.stringify({ context_window: { used_percentage: null } }))).toBeUndefined();
    expect(contextUsedPercentageFromStatusLine("{}")).toBeUndefined();
    expect(contextUsedPercentageFromStatusLine("oops")).toBeUndefined();
  });
});
