/**
 * tmux のステータスライン: 印が変わったら、status-interval を待たずに描き直させる（`#()` も再実行される）
 * 出来事の連鎖が終わってから比べる（表示中のペインで完了したときに、✓ が一瞬点いて消える描き直しをしない）
 */

import { selectStatusFlags } from "../../redux/modules/app/attention/selector.ts";
import { type AppSubscriber, observe } from "./observe.ts";
import * as tmux from "./tmux.ts";

export const statusLine = (): AppSubscriber => (store) =>
  void observe(store, (st) => JSON.stringify(selectStatusFlags(st)), tmux.refreshStatus, { settle: true });
