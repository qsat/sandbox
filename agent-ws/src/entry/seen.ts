import { sessionsRequested, seenInPaneRequested } from "../redux/modules/sessions/slice.ts";
import { sessionListeners } from "../redux/modules/sessions/listener.ts";
import { statusLineListeners } from "../redux/modules/statusLine/listener.ts";
import { initStore } from "./store.ts";

/** tmux の pane-focus-in から呼ばれる。既読にしたらステータスラインを描き直す */
export function runSeen(panePid: number): void {
  const store = initStore(sessionListeners(), statusLineListeners());
  store.dispatch(sessionsRequested());
  store.dispatch(seenInPaneRequested({ panePid, at: Date.now() }));
}
