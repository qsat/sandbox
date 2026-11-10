import type { AppStore } from "../redux/createStore.ts";
import { claudeHooks, hookReceived, interruptionChecks } from "../redux/listeners/claude/index.ts";
import * as git from "../redux/listeners/git/git.ts";
import { tmux } from "../redux/listeners/tmux/index.ts";
import { notifier } from "../ui/subscribers/notifier.ts";
import { statusLine } from "../ui/subscribers/statusLine.ts";
import { start } from "./start.ts";
import type { Context } from "./types.ts";

/** Claude Code の hook が呼ばれた（1回の hook の起動に当たる）。input は stdin の JSON */
export function hook(input: unknown, ctx: Context): AppStore {
  const locate = (cwd: string) => git.locate(cwd, ctx.ghq);
  const notices = notifier({ kinds: ctx.notify, inTmux: ctx.inTmux, platform: ctx.platform, locate });
  const store = start(ctx, [...claudeHooks({ parent: ctx.ppid }), ...interruptionChecks(), ...tmux()], {
    subscribers: [statusLine(), notices],
  });
  store.dispatch(hookReceived({ input, at: ctx.now }));
  return store;
}
