import type { AppStore } from "../../redux/createStore.ts";
import { claude, hookReceived } from "../../redux/middlewares/claude/index.ts";
import { tmux } from "../../redux/middlewares/tmux/index.ts";
import { notifier } from "../../redux/subscribers/notifier/index.ts";
import { statusLine } from "../../redux/subscribers/statusLine.ts";
import { notification } from "../../ui/view.ts";
import type { Context } from "../context.ts";
import { start } from "./start.ts";

/** Claude Code の hook が呼ばれた（1回の hook の起動に当たる）。input は stdin の JSON */
export function hook(input: unknown, ctx: Context): AppStore {
  const notices = notifier({ kinds: ctx.notify, ghq: ctx.ghq, inTmux: ctx.inTmux, format: notification });
  const store = start(ctx, [claude(), tmux()], { subscribers: [statusLine(), notices] });
  store.dispatch(hookReceived({ input, at: ctx.now }));
  return store;
}
