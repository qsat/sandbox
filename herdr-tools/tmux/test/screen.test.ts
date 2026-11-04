import { describe, expect, test } from "bun:test";
import { alignRight, fitToWidth, frame, withBackground } from "../src/ui/screen";

describe("alignRight", () => {
  test("色の指定を幅に数えずに右へ寄せる", () => {
    expect(alignRight("\x1b[1mab\x1b[0m", 5)).toBe("   \x1b[1mab\x1b[0m");
  });
});

describe("withBackground", () => {
  test("行の端まで背景を敷き、行の中で色を戻した後にも背景を敷き直す", () => {
    const BG = "\x1b[48;2;1;2;3m";
    expect(withBackground("\x1b[1ma\x1b[0mb", BG, 4)).toBe(`${BG}\x1b[1ma\x1b[0m${BG}b  \x1b[0m`);
  });
});

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
    expect(frame(["abcdef", "b", "c"], { columns: 6, rows: 4 }, { x: 1, y: 1 })).toBe("\r\n abcd\r\n b");
  });
  test("左右と上下の余白は別々に決められる", () => {
    expect(frame(["abcdefgh", "b", "c"], { columns: 8, rows: 4 }, { x: 3, y: 1 })).toBe("\r\n   ab\r\n   b");
  });
});
