import { type AppListener, addAppListener, type RootState } from "../../../createStore.ts";
import * as tmux from "../../../infra/tmux.ts";
import { isSessionAction } from "../../app/sessions/slice.ts";
import { selectStatusFlags } from "./selector.ts";

const flags = (st: RootState) => JSON.stringify(selectStatusFlags(st));

/** 印が変わったら、status-interval を待たずに tmux のステータスラインを描き直す */
export const statusLineListeners = (): AppListener[] => [
  addAppListener({
    predicate: (action, cur, prev) => isSessionAction(action) && flags(cur) !== flags(prev),
    effect: () => tmux.refreshStatus(),
  }),
];
