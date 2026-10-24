/**
 * エージェントを追い続ける（watch）: 時間の経過に合わせて、確認を頼み続ける。I/O は middleware が受け持つ
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import { type AppListener, addAppListener, type RootState } from "../../../createStore.ts";
import { selectAgentProcesses, selectAgents } from "./selector.ts";
import {
  agentAttached,
  agentForgotten,
  agentProcessesRequested,
  followStarted,
  interruptionCheckRequested,
  livenessCheckRequested,
  logsChanged,
} from "./slice.ts";

/** エージェントが増えた（pid がまだプロセス一覧に無い）・消えたら、interval を待たずにプロセスを取り直す */
const needsRescan = (a: UnknownAction, st: RootState) =>
  agentForgotten.match(a) ||
  (agentAttached.match(a) && selectAgents(st).some((x) => x.pid && !selectAgentProcesses(st).some((p) => p.pid === x.pid)));

export const agentListeners = (): AppListener[] => [
  addAppListener({
    actionCreator: followStarted,
    effect: async ({ payload: { intervalMs } }, api) => {
      api.fork(async (f) => {
        for (;;) {
          const [action] = await f.pause(api.take(needsRescan));
          // SessionEnd はプロセスが終わる前に届くので、終わるのを少し待つ
          if (agentForgotten.match(action)) await f.delay(1000);
          api.dispatch(agentProcessesRequested());
        }
      });
      for (;;) {
        const at = Date.now();
        api.dispatch(logsChanged()); // ログの見張りが取りこぼしたときの保険
        api.dispatch(livenessCheckRequested({ at }));
        api.dispatch(interruptionCheckRequested({ at }));
        api.dispatch(agentProcessesRequested());
        await api.delay(intervalMs);
      }
    },
  }),
];
