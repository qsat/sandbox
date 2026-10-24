import { expect, test } from "bun:test";
import { createStore } from "../../../../createStore.ts";
import { visited } from "../../visit/slice.ts";
import { cursorSet, scrolled } from "../slice.ts";

test("選択を動かすと、前の移動の結果は消える", () => {
  const store = createStore();
  store.dispatch(visited({ kind: "notFound", title: "x" }));
  store.dispatch(scrolled(3));
  expect(store.getState().ui).toEqual({ visit: { last: { kind: "notFound", title: "x" } }, watch: { cursor: null, top: 3 } });
  store.dispatch(cursorSet("pid:1"));
  expect(store.getState().ui).toEqual({ visit: { last: null }, watch: { cursor: "pid:1", top: 3 } });
});
