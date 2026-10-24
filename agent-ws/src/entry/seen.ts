import { tmux } from "../redux/middlewares/tmux/index.ts";
import { agentsRequested } from "../redux/modules/app/agents/slice.ts";
import { paneFocused } from "../redux/modules/ui/visit/slice.ts";
import { storeWith } from "./store.ts";

/** tmux の pane-focus-in から呼ばれる。確認したらステータスラインを描き直す */
export function runSeen(panePid: number): void {
  const store = storeWith(tmux());
  store.dispatch(agentsRequested());
  store.dispatch(paneFocused({ panePid, at: Date.now() }));
}
