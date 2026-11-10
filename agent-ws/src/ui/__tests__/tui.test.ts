import { expect, test } from "bun:test";
import type { Row } from "../parts.ts";
import { effectiveCursor, viewport } from "../tui.ts";

const row = (key?: string, priority?: number): Row => ({ prefix: "", cells: [], key, priority });

test("effectiveCursor: 選んだ行が無くなっていれば、優先度の一番高い行を選んでいるものとして出す", () => {
  const rows = [row(), row("repo"), row("a", 1), row("b", 3), row()];
  expect(effectiveCursor(rows, "a")).toBe(2);
  expect(effectiveCursor(rows, "gone")).toBe(3); // 許可待ちなど優先度の高い行
  expect(effectiveCursor(rows, null)).toBe(3);
  expect(effectiveCursor([row(), row()], null)).toBe(-1);
});

test("viewport: 選択中の行を含むページを出す（最後のページは画面いっぱいに出す）", () => {
  expect(viewport(0, 10, 25)).toBe(0);
  expect(viewport(12, 10, 25)).toBe(10);
  expect(viewport(24, 10, 25)).toBe(15);
  expect(viewport(3, 10, 5)).toBe(0);
  expect(viewport(-1, 10, 5)).toBe(0);
});
