import { expect, test } from "bun:test";
import { ghosttyWindowIdShowing } from "../src/ghostty";

const windows = [
  { id: 1, app: "Ghostty", title: "api [/dev/ttys013]" },
  { id: 2, app: "Ghostty", title: "web [/dev/ttys01]" },
  { id: 3, app: "Code", title: "x [/dev/ttys002]" },
];

test("タイトルにクライアントの tty の印がある Ghostty のウインドウを選ぶ。/dev/ttys01 は /dev/ttys013 のウインドウに当てない", () => {
  expect(ghosttyWindowIdShowing(windows, "/dev/ttys013")).toBe(1);
  expect(ghosttyWindowIdShowing(windows, "/dev/ttys01")).toBe(2);
});

test("Ghostty でないアプリのウインドウ、見つからないとき、yabai の結果が読めないときは undefined", () => {
  expect(ghosttyWindowIdShowing(windows, "/dev/ttys002")).toBeUndefined();
  expect(ghosttyWindowIdShowing(windows, "/dev/ttys099")).toBeUndefined();
  expect(ghosttyWindowIdShowing(undefined, "/dev/ttys013")).toBeUndefined();
});
