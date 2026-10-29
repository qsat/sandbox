import type { AppStore } from "../redux/createStore.ts";
import { interruptionChecks, transcriptWatch } from "../redux/listeners/claude/index.ts";
import { clock } from "../redux/listeners/clock/index.ts";
import { dirtyCounts, repositories } from "../redux/listeners/git/index.ts";
import { processList, processLiveness } from "../redux/listeners/processes/index.ts";
import { tmux } from "../redux/listeners/tmux/index.ts";
import { destinationChosen } from "../redux/modules/ui/visit/slice.ts";
import { reloadPressed, rowSelected, watchOpened } from "../redux/modules/ui/watch/slice.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import { statusLine } from "../ui/subscribers/statusLine.ts";
import { start } from "./start.ts";
import type { Context, Of } from "./types.ts";

/** 常駐表示: ログを追い続け、interval ごとにスキャンする */
export function watch(c: Of<"watch">, ctx: Context): AppStore {
  const listeners = [
    ...processLiveness(),
    ...processList({ self: ctx.pid }),
    ...dirtyCounts({ filter: c.filter }), // repositories より先に組む
    ...repositories({ ghq: ctx.ghq, query: c.query }),
    ...interruptionChecks(),
    ...transcriptWatch(),
    ...tmux(),
    ...clock({ intervalMs: c.intervalMs }),
  ];
  const store = start(ctx, listeners, { follow: true, subscribers: [statusLine()] });
  store.dispatch(watchOpened({ popup: c.popup }));
  return store;
}

/** 常駐表示での人の操作 → 出来事 */
export const watchControls = (store: AppStore) => ({
  select: (key: string | null) => store.dispatch(rowSelected(key)), // 行を選んだ
  choose: (target: VisitTarget) => store.dispatch(destinationChosen({ target, create: true })), // 行き先を選んだ（Enter）
  reload: () => store.dispatch(reloadPressed()), // 読み直しを頼んだ（r）
});
