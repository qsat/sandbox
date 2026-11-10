import type { AppStore } from "../redux/createStore.ts";
import { tmux } from "../redux/listeners/tmux/index.ts";
import { paneFocused } from "../redux/modules/ui/visit/slice.ts";
import { statusLine } from "../ui/subscribers/statusLine.ts";
import { start } from "./start.ts";
import type { Context, Of } from "./types.ts";

/** 人がそのペインにフォーカスした（tmux の pane-focus-in から）。確認したらステータスラインを描き直す */
export function seen(c: Of<"seen">, ctx: Context): AppStore {
  const store = start(ctx, tmux(), { subscribers: [statusLine()] });
  store.dispatch(paneFocused({ panePid: c.panePid, at: ctx.now }));
  return store;
}
