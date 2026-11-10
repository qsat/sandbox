import type { RootState } from "../../../rootReducer.ts";
import { selectLastVisit } from "../visit/selector.ts";

export const selectWatchView = (st: RootState) => st.ui.watch;

/** 画面に出す移動の結果（行を選び直した後は出さない） */
export const selectShownVisit = (st: RootState) => {
  if (!st.ui.watch.showsVisit) return null;
  return selectLastVisit(st);
};

/** popup で開いていて、行き先へ移れたら閉じる */
export const selectShouldClose = (st: RootState) => {
  const last = selectLastVisit(st);
  return st.ui.watch.popup && (last?.kind === "focused" || last?.kind === "created");
};
