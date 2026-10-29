/**
 * clock: 時間の経過を出来事にする（listener）。起動したら interval ごとに ticked を出す（watch で組む）
 */
import { type AppListener, addAppListener } from "../../createStore.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";

export const clock = (o: { intervalMs: number }): AppListener[] => [
  addAppListener({
    actionCreator: initialized,
    effect: (_, api) => void setInterval(() => api.dispatch(ticked({ at: Date.now() })), o.intervalMs),
  }),
];
