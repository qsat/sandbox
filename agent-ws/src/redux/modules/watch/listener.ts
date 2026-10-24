/**
 * watch の常駐: 定期スキャンと、ログの変化の取り込み
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import * as eventLog from "../../../infra/eventLog.ts";
import { addAppListener, type AppListener, type RootState } from "../../createStore.ts";
import { selectSessions } from "../sessions/selector.ts";
import { forgotten, logReplayed, logsChanged, settleRequested } from "../sessions/slice.ts";
import { dirtyRequested, processesRequested, reposRequested } from "../workspace/slice.ts";
import { watchStarted } from "./slice.ts";

/** セッションが増えた（pid がまだプロセス一覧に無い）・消えたら、interval を待たずにプロセスを取り直す */
const needsRescan = (a: UnknownAction, st: RootState) =>
  forgotten.match(a) ||
  (logReplayed.match(a) && selectSessions(st).some((s) => s.pid && !st.workspace.processes.some((p) => p.pid === s.pid)));

export const watchListeners = (): AppListener[] => [
  addAppListener({
    actionCreator: watchStarted,
    effect: async ({ payload: p }, api) => {
      let timer: Timer | undefined;
      const stop = eventLog.watch(() => {
        clearTimeout(timer); // 連続した追記はまとめて取り込む
        timer = setTimeout(() => api.dispatch(logsChanged()), 50);
      });
      api.fork(async (f) => {
        for (;;) {
          const [action] = await f.pause(api.take(needsRescan));
          // SessionEnd はプロセスが終わる前に届くので、終わるのを少し待つ
          if (forgotten.match(action)) await f.delay(1000);
          api.dispatch(processesRequested());
        }
      });
      try {
        for (let reposAt = 0; ; await api.delay(p.intervalMs)) {
          if (Date.now() - reposAt > 15_000) {
            api.dispatch(reposRequested({ roots: p.roots, query: p.query }));
            reposAt = Date.now();
          }
          api.dispatch(logsChanged());
          api.dispatch(settleRequested({ at: Date.now() }));
          api.dispatch(processesRequested());
          api.dispatch(dirtyRequested({ filter: p.filter }));
        }
      } finally {
        stop();
      }
    },
  }),
];
