/**
 * Store の組み立て: コマンドごとに要る middleware を選んで Store を作り、起動した（initialized）ことを伝える。
 * 起動したときに何をするか（ログの読み込み・スキャンなど）は、組まれた middleware がそれぞれ決める。
 * 人に見せるもの（ステータスライン・通知）は、ログから状態を組み立て終えた後に購読させる（それより後の変化だけを映す）
 */
import { type AppMiddleware, type AppStore, createStore } from "../redux/createStore.ts";
import { type EventLogOptions, eventLog } from "../redux/middlewares/eventLog/index.ts";
import { initialized } from "../redux/modules/app/lifecycle/slice.ts";
import type { AppSubscriber } from "../redux/subscribers/observe.ts";

export interface StartOptions {
  log?: EventLogOptions;
  subscribers?: AppSubscriber[];
}

/** 出来事を記録する Store を作って起動する（記録は reducer の直前、effects はその外側に組まれる） */
export function start(effects: AppMiddleware[], o: StartOptions = {}): AppStore {
  const store = createStore({ log: eventLog(o.log), effects });
  store.dispatch(initialized({ at: Date.now() }));
  for (const subscribe of o.subscribers ?? []) subscribe(store);
  return store;
}
