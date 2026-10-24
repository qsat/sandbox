/**
 * ワークスペースをスキャンし続ける（watch）: 時間の経過に合わせて、スキャンを頼み続ける。I/O は middleware が受け持つ
 */
import { type AppListener, addAppListener } from "../../../createStore.ts";
import { dirtyRequested, reposRequested, scanStarted } from "./slice.ts";

export const workspaceListeners = (): AppListener[] => [
  addAppListener({
    actionCreator: scanStarted,
    effect: async ({ payload: p }, api) => {
      for (let reposAt = 0; ; await api.delay(p.intervalMs)) {
        if (Date.now() - reposAt > 15_000) {
          api.dispatch(reposRequested({ query: p.query }));
          reposAt = Date.now();
        }
        api.dispatch(dirtyRequested({ filter: p.filter }));
      }
    },
  }),
];
