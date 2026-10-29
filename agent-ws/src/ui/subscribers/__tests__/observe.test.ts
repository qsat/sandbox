import { expect, test } from "bun:test";
import { createStore } from "../../../redux/createStore.ts";
import { initialized, ticked } from "../../../redux/modules/app/lifecycle/slice.ts";
import { rowSelected } from "../../../redux/modules/ui/watch/slice.ts";
import { observe } from "../observe.ts";

test("見ている部分が変わったときだけ、新旧の値で呼ぶ（購読した時点の値では呼ばない）", () => {
  const store = createStore();
  store.dispatch(initialized({ at: 1 }));
  const calls: [number, number][] = [];
  observe(
    store,
    (st) => st.app.lifecycle.now,
    (next, prev) => calls.push([next, prev]),
  );
  store.dispatch(rowSelected("x")); // 見ていない部分の変化
  store.dispatch(ticked({ at: 1 })); // 同じ値
  store.dispatch(ticked({ at: 5 }));
  expect(calls).toEqual([[5, 1]]);
});
