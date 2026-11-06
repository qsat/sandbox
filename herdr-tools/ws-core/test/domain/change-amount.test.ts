import { describe, expect, test } from "bun:test";
import { addChangeAmounts, countTextLines, sumNumstat } from "../../src/domain/change-amount";

describe("変更量", () => {
  test("numstat の行数を足し、バイナリ（-）は数えない", () => {
    expect(sumNumstat("3\t1\ta.ts\x0010\t0\tb.ts\x00-\t-\timg.png\x00")).toEqual({ added: 13, deleted: 1 });
    expect(sumNumstat("")).toEqual({ added: 0, deleted: 0 });
  });
  test("テキストの行数は、最後の行に改行が無くても 1 行と数え、NUL を含むものは数えない", () => {
    expect(countTextLines("a\nb\n")).toBe(2);
    expect(countTextLines("a\nb")).toBe(2);
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("a\0b\n")).toBe(0);
  });
  test("足し合わせる", () => expect(addChangeAmounts({ added: 1, deleted: 2 }, { added: 3, deleted: 0 })).toEqual({ added: 4, deleted: 2 }));
});
