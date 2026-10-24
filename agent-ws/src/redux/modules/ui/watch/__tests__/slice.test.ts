import { expect, test } from "bun:test";
import { createStore } from "../../../../createStore.ts";
import { visited } from "../../visit/slice.ts";
import { selectShouldClose } from "../selector.ts";
import { rowSelected, watchOpened } from "../slice.ts";

test("行を選ぶと、前の移動の結果は消える", () => {
  const store = createStore();
  store.dispatch(visited({ kind: "notFound", title: "x" }));
  expect(store.getState().ui.visit.last).toEqual({ kind: "notFound", title: "x" });
  store.dispatch(rowSelected("pid:1"));
  expect(store.getState().ui).toEqual({ visit: { last: null }, watch: { cursor: "pid:1", popup: false } });
});

test("popup で開いていて、行き先へ移れたら閉じる", () => {
  const pane = { id: "%1", pid: 1, session: "s", window: "0", windowName: "w", path: "/w", active: true };
  const inPopup = createStore();
  inPopup.dispatch(watchOpened({ popup: true }));
  inPopup.dispatch(visited({ kind: "notFound", title: "x" }));
  expect(selectShouldClose(inPopup.getState())).toBe(false);
  inPopup.dispatch(visited({ kind: "focused", pane }));
  expect(selectShouldClose(inPopup.getState())).toBe(true);

  const inWindow = createStore();
  inWindow.dispatch(watchOpened({ popup: false }));
  inWindow.dispatch(visited({ kind: "focused", pane }));
  expect(selectShouldClose(inWindow.getState())).toBe(false);
});
