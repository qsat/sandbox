/**
 * Store の組み立て: コマンドごとに要る listener を選んで Store を作り、起動した（initialized）ことを伝える。
 * 起動したときに何をするか（ログの読み込み・スキャンなど）は、組まれた listener がそれぞれ決める。
 * 人に見せるもの（ステータスライン・通知）は、ログから状態を組み立て終えた後に購読させる（それより後の変化だけを映す）
 */
import { type AppListener, type AppStore, createStore } from "../redux/createStore.ts";
import { type EventLog, eventLog } from "../redux/listeners/eventLog/index.ts";
import { initialized } from "../redux/modules/app/lifecycle/slice.ts";
import type { AppSubscriber } from "../ui/subscribers/observe.ts";
import type { Context } from "./types.ts";

export interface StartOptions {
  follow?: boolean; // 他のプロセスが書いたログを取り込み続ける（watch）
  subscribers?: AppSubscriber[];
}

/** 記録は常に組む。取り込み続けるのは follow のときだけ */
const logListeners = (log: EventLog, follow?: boolean) => {
  if (!follow) return log.record;
  return [...log.record, ...log.follow];
};

/** 出来事を記録する Store を作って起動する（記録の listener は、ほかの listener より先に登録される） */
export function start(ctx: Context, listeners: AppListener[], o: StartOptions = {}): AppStore {
  const store = createStore({ log: logListeners(eventLog({ dir: ctx.stateDir }), o.follow), listeners });
  store.dispatch(initialized({ at: ctx.now }));
  for (const subscribe of o.subscribers ?? []) subscribe(store);
  return store;
}
