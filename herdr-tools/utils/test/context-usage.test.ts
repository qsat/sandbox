import { describe, expect, test } from "bun:test";
import { contextUsage } from "../src/context-usage";

describe("contextUsage", () => {
  const live = { alive: true, resumable: false };
  test("ctx 42%。多いほど強い色（70% 以上 strong、90% 以上 danger）", () => {
    expect(contextUsage({ ...live, contextUsedPercentage: 42 })).toEqual({ used: 42, tone: "muted", text: "ctx 42%" });
    expect(contextUsage({ ...live, contextUsedPercentage: 75 })?.tone).toBe("strong");
    expect(contextUsage({ ...live, contextUsedPercentage: 95 })?.tone).toBe("danger");
  });
  test("記録が無い・終了した・claude が落ちて要再開のときは出さない（値が古い）", () => {
    expect(contextUsage(live)).toBeUndefined();
    expect(contextUsage({ alive: false, resumable: false, contextUsedPercentage: 42 })).toBeUndefined();
    expect(contextUsage({ alive: true, resumable: true, contextUsedPercentage: 42 })).toBeUndefined();
  });
});
