/**
 * Store の組み立て: コマンドごとに要る middleware を選んで Store を作り、起動した（initialized）ことを伝える。
 * 起動したときに何をするか（ログの読み込み・スキャンなど）は、組まれた middleware がそれぞれ決める。
 * 人に見せるもの（ステータスライン・通知）は、ログから状態を組み立て終えた後に購読させる（それより後の変化だけを映す）
 */
import { type AppMiddleware, type AppStore, createStore } from "../redux/createStore.ts";
import { eventLog } from "../redux/middlewares/eventLog/index.ts";
import { initialized } from "../redux/modules/app/lifecycle/slice.ts";
import type { AppSubscriber } from "../ui/subscribers/observe.ts";
import type { Context } from "./types.ts";

export interface StartOptions {
  follow?: boolean; // 他のプロセスが書いたログを取り込み続ける（watch）
  subscribers?: AppSubscriber[];
}

/** 出来事を記録する Store を作って起動する（記録は reducer の直前、effects はその外側に組まれる） */
export function start(ctx: Context, effects: AppMiddleware[], o: StartOptions = {}): AppStore {
  const store = createStore({ log: eventLog({ dir: ctx.stateDir, follow: o.follow }), effects });
  store.dispatch(initialized({ at: ctx.now }));
  for (const subscribe of o.subscribers ?? []) subscribe(store);
  return store;
}
