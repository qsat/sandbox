import { describe, expect, test } from "bun:test";
import { pieSvg } from "../build/pie-svgs";

describe("pieSvg（円周の上の弧。12 時から時計回り。外側の半径 12、内側の半径 8）", () => {
  test("25% は右上の 4 分の 1 の弧（外側を 3 時まで進み、内側を 12 時へ戻る）", () => expect(pieSvg(25)).toContain('d="M12 0A12 12 0 0 1 24.000 12.000L20.000 12.000A8 8 0 0 0 12 4Z"'));
  test("50% を超えると、外側も内側も大きい弧", () => expect(pieSvg(75)).toContain('d="M12 0A12 12 0 1 1 0.000 12.000L4.000 12.000A8 8 0 1 0 12 4Z"'));
  test("100% は輪の全体（外側の円と、逆回りの内側の円）", () => expect(pieSvg(100)).toContain('d="M12 0A12 12 0 1 1 12 24A12 12 0 1 1 12 0ZM12 4A8 8 0 1 0 12 20A8 8 0 1 0 12 4Z"'));
  test("中心（12 12）を通らないので、内側は塗られない", () => expect(pieSvg(40)).not.toContain("M12 12"));
  test("文字色で塗る", () => expect(pieSvg(10)).toContain('fill="currentColor"'));
});
