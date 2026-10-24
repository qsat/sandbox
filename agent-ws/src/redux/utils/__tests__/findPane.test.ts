import { expect, test } from "bun:test";
import type { Pane } from "../../types/navigation.ts";
import { findPane } from "../findPane.ts";

test("findPane: pid の祖先 → パスの順で探す", () => {
  const pane = (id: string, pid: number, path: string): Pane => ({
    id,
    pid,
    path,
    session: "s",
    window: "0",
    windowName: "w",
    active: false,
  });
  const panes = [pane("%1", 100, "/w/a"), pane("%2", 200, "/w/b")];
  const parent = new Map([
    [300, 250],
    [250, 200],
  ]);
  expect(findPane({ title: "", name: "", pid: 300 }, panes, (p) => parent.get(p))?.id).toBe("%2");
  expect(findPane({ title: "", name: "", path: "/w/a" }, panes, () => undefined)?.id).toBe("%1");
});
