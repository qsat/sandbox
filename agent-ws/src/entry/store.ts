/**
 * 各コマンドの Store の初期化: 共通の Store に、そのコマンドで要る listener だけを登録する
 */
import { createStore, listen, type AppListener, type AppStore } from "../redux/createStore.ts";
import { sessionListeners } from "../redux/modules/app/sessions/listener.ts";
import { sessionsRequested, settleRequested } from "../redux/modules/app/sessions/slice.ts";

export function initStore(...groups: AppListener[][]): AppStore {
  const store = createStore();
  listen(store, ...groups);
  return store;
}

/** ログからセッションを組み立て、消えたプロセス・中断を片付けた Store */
export function sessionStore(...groups: AppListener[][]): AppStore {
  const store = initStore(sessionListeners(), ...groups);
  store.dispatch(sessionsRequested());
  store.dispatch(settleRequested({ at: Date.now() }));
  return store;
}
