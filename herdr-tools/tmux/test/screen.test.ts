import { describe, expect, test } from "bun:test";
import { fitToWidth, frame } from "../src/ui/screen";

describe("fitToWidth", () => {
  test("表示幅で切る（全角は 2 桁）", () => {
    expect(fitToWidth("abc", 2)).toBe("ab");
    expect(fitToWidth("日本語", 5)).toBe("日本");
    expect(fitToWidth("abc", 5)).toBe("abc");
  });
  test("色の指定は幅に数えず、切ったときは色を戻す", () => {
    expect(fitToWidth("\x1b[1mabc\x1b[0m", 2)).toBe("\x1b[1mab\x1b[0m");
    expect(fitToWidth("\x1b[1mab\x1b[0m", 2)).toBe("\x1b[1mab\x1b[0m");
  });
});

describe("frame", () => {
  test("上と左右に 1 文字ぶんの余白を取り、下の 1 行は空けておく", () => {
    expect(frame(["abcdef", "b", "c"], { columns: 6, rows: 4 }, 1)).toBe("\r\n abcd\r\n b");
  });
});
