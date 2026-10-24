import type { RootState } from "../../../createStore.ts";
import { selectLastVisit } from "../visit/selector.ts";

export const selectWatchView = (st: RootState) => st.ui.watch;

/** popup で開いていて、行き先へ移れたら閉じる */
export const selectShouldClose = (st: RootState) => {
  const last = selectLastVisit(st);
  return st.ui.watch.popup && (last?.kind === "focused" || last?.kind === "created");
};
