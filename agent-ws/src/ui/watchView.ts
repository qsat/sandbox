import type { RootState } from "../redux/createStore.ts";
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { selectShouldClose, selectWatchView } from "../redux/modules/ui/watch/selector.ts";
import type { VisitResult } from "../redux/types/visit.ts";
import { type Cell, visitMessage } from "./view.ts";

const messageOf = (last: VisitResult | null) => {
  if (!last) return undefined;
  return visitMessage(last);
};

/** 常駐表示の画面の状態: 人が選んだ行・いまの時刻・移動の結果・閉じるか */
export const watchViewOf = (st: RootState): { cursor: string | null; now: number; message?: Cell; close: boolean } => ({
  cursor: selectWatchView(st).cursor,
  now: selectNow(st),
  message: messageOf(selectLastVisit(st)),
  close: selectShouldClose(st),
});
