import { describe, expect, test } from "bun:test";
import { usageSegments } from "../src/usage-segments";

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

describe("usageSegments", () => {
  test("残り（100 - 使用率）とリセット時刻。5h は時刻、週は日付つき", () => {
    const segments = usageSegments({ fiveHour: { usedPercentage: 23.5, resetsAtEpochSec: at(2026, 11, 2, 14, 0) }, sevenDay: { usedPercentage: 41.2, resetsAtEpochSec: at(2026, 11, 5, 9, 30) } });
    expect(segments.map((s) => s.text)).toEqual(["5h 残り77%（14:00）", "週 残り59%（11/5 09:30）"]);
  });
  test("残りが少ないほど強い色（30% 以下 strong、10% 以下 danger）", () => {
    const tone = (used: number) => usageSegments({ fiveHour: { usedPercentage: used, resetsAtEpochSec: 0 } })[0]!.tone;
    expect([tone(50), tone(75), tone(95)]).toEqual(["muted", "strong", "danger"]);
  });
  test("無い枠は出さない", () => expect(usageSegments({})).toEqual([]));
});
