import type { AppStore } from "../../redux/createStore.ts";
import { claude } from "../../redux/middlewares/claude/index.ts";
import { clock } from "../../redux/middlewares/clock/index.ts";
import { git } from "../../redux/middlewares/git/index.ts";
import { processes } from "../../redux/middlewares/processes/index.ts";
import { tmux } from "../../redux/middlewares/tmux/index.ts";
import { destinationChosen } from "../../redux/modules/ui/visit/slice.ts";
import { reloadPressed, rowSelected, watchOpened } from "../../redux/modules/ui/watch/slice.ts";
import type { VisitTarget } from "../../redux/types/visit.ts";
import { statusLine } from "../../ui/subscribers/statusLine.ts";
import { start } from "./start.ts";
import type { Context, Of } from "./types.ts";

/** 常駐表示: ログを追い続け、interval ごとにスキャンする */
export function watch(c: Of<"watch">, ctx: Context): AppStore {
  const effects = [
    processes({ list: true, self: ctx.pid }),
    git({ ghq: ctx.ghq, repos: { query: c.query }, dirty: c.filter }),
    claude({ parent: ctx.ppid, follow: true }),
    tmux(),
    clock({ intervalMs: c.intervalMs }),
  ];
  const store = start(ctx, effects, { follow: true, subscribers: [statusLine()] });
  store.dispatch(watchOpened({ popup: c.popup }));
  return store;
}

/** 常駐表示での人の操作 → 出来事 */
export const watchControls = (store: AppStore) => ({
  select: (key: string | null) => store.dispatch(rowSelected(key)), // 行を選んだ
  choose: (target: VisitTarget) => store.dispatch(destinationChosen({ target, create: true })), // 行き先を選んだ（Enter）
  reload: () => store.dispatch(reloadPressed()), // 読み直しを頼んだ（r）
});
