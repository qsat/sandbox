/**
 * clock middleware: 時間の経過を出来事にする。起動したら interval ごとに ticked を出す（watch で組む）
 */
import type { AppMiddleware } from "../../createStore.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";

export const clock =
  (o: { intervalMs: number }): AppMiddleware =>
  (api) => {
    let timer: Timer | undefined;
    return (next) => (action) => {
      const result = next(action);
      if (initialized.match(action) && !timer) timer = setInterval(() => api.dispatch(ticked({ at: Date.now() })), o.intervalMs);
      return result;
    };
  };
