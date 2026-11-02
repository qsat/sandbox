import { describe, expect, test } from "bun:test";
import { pieSvg } from "../build/pie-svgs";

describe("pieSvg（円グラフの扇形。12 時から時計回り）", () => {
  test("25% は右上の 4 分の 1", () => expect(pieSvg(25)).toContain('d="M12 12L12 0A12 12 0 0 1 24.000 12.000Z"'));
  test("50% を超えると大きい弧", () => expect(pieSvg(75)).toContain("A12 12 0 1 1 0.000 12.000Z"));
  test("100% は円", () => expect(pieSvg(100)).toContain('<circle cx="12" cy="12" r="12"/>'));
  test("文字色で塗る", () => expect(pieSvg(10)).toContain('fill="currentColor"'));
});
