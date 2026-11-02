import { describe, expect, test } from "bun:test";
import { countdown } from "../src/countdown";
import { usageSegments } from "../src/usage-segments";

const NOW = 1_800_000_000;
const HOUR = 3600;

describe("usageSegments", () => {
  test("消費した % と、リセットまでの残り時間（0d 0h 0m）", () => {
    const segments = usageSegments({ fiveHour: { usedPercentage: 23.5, resetsAtEpochSec: NOW + 2 * HOUR + 14 * 60 }, sevenDay: { usedPercentage: 41.2, resetsAtEpochSec: NOW + 3 * 24 * HOUR + 5 * HOUR } }, NOW);
    expect(segments.map((s) => s.text)).toEqual(["5h 24% 0d 2h 14m", "週 41% 3d 5h 0m"]);
  });
  test("消費が多いほど強い色（70% 以上 strong、90% 以上 danger）", () => {
    const tone = (used: number) => usageSegments({ fiveHour: { usedPercentage: used, resetsAtEpochSec: NOW } }, NOW)[0]!.tone;
    expect([tone(50), tone(75), tone(95)]).toEqual(["muted", "strong", "danger"]);
  });
  test("無い枠は出さない", () => expect(usageSegments({}, NOW)).toEqual([]));
});

describe("countdown", () => {
  test("日・時・分。過ぎていれば 0", () => {
    expect(countdown(90061)).toBe("1d 1h 1m");
    expect(countdown(59)).toBe("0d 0h 0m");
    expect(countdown(-10)).toBe("0d 0h 0m");
  });
});
