import { expect, test } from "bun:test";
import { PANE_FORMAT, parsePanes } from "../parse.ts";

test("list-panes: 表示中は、アクティブなウィンドウのアクティブなペインで、クライアントが接続しているもの", () => {
  const out = [
    "%0|~|439|~|my s|~|0|~|win 1|~|/w/api|~|1|~|1|~|1", // 表示中
    "%1|~|440|~|my s|~|1|~|feat|~|/w/api-feat|~|1|~|0|~|1", // ウィンドウが裏
    "%2|~|441|~|other|~|0|~|x|~|/w|~|1|~|1|~|0", // クライアントが接続していない
  ].join("\n");
  expect(parsePanes(out)).toEqual([
    { id: "%0", pid: 439, session: "my s", window: "0", windowName: "win 1", path: "/w/api", active: true },
    { id: "%1", pid: 440, session: "my s", window: "1", windowName: "feat", path: "/w/api-feat", active: false },
    { id: "%2", pid: 441, session: "other", window: "0", windowName: "x", path: "/w", active: false },
  ]);
  expect(parsePanes("")).toEqual([]);
});

test("書式は ASCII の区切りでフィールドを並べる（tmux は制御文字を _ に置き換えるため）", () => {
  expect(PANE_FORMAT.split("|~|")).toHaveLength(9);
});
