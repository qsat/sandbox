/**
 * 常駐表示の画面の状態: 人が選んだ行・いまの時刻・移動の結果・閉じるか（行そのものは list.ts の listRows）
 */
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectShouldClose, selectShownVisit, selectWatchView } from "../redux/modules/ui/watch/selector.ts";
import type { RootState } from "../redux/rootReducer.ts";
import type { VisitResult } from "../redux/types/visit.ts";
import { visitMessage } from "./jump.ts";
import type { Cell } from "./parts.ts";

const messageOf = (last: VisitResult | null) => {
  if (!last) return undefined;
  return visitMessage(last);
};

/** 常駐表示の画面の状態: 人が選んだ行・いまの時刻・移動の結果・閉じるか */
export const watchViewOf = (st: RootState): { cursor: string | null; now: number; message?: Cell; close: boolean } => ({
  cursor: selectWatchView(st).cursor,
  now: selectNow(st),
  message: messageOf(selectShownVisit(st)),
  close: selectShouldClose(st),
});
