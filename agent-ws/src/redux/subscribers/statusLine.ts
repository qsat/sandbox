/**
 * tmux のステータスライン: 印が変わったら、status-interval を待たずに描き直させる（`#()` も再実行される）
 */
import * as tmux from "../middlewares/tmux/tmux.ts";
import { selectStatusFlags } from "../modules/app/attention/selector.ts";
import { type AppSubscriber, observe } from "./observe.ts";

export const statusLine = (): AppSubscriber => (store) =>
  void observe(store, (st) => JSON.stringify(selectStatusFlags(st)), tmux.refreshStatus);
