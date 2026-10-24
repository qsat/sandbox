import { tmux } from "../redux/middlewares/tmux/index.ts";
import { paneFocused } from "../redux/modules/ui/visit/slice.ts";
import { start } from "./store.ts";

/** tmux の pane-focus-in から呼ばれる。確認したらステータスラインを描き直す */
export function runSeen(panePid: number): void {
  start([tmux()]).dispatch(paneFocused({ panePid, at: Date.now() }));
}
