/**
 * Store の組み立て: コマンドごとに要る middleware（と listener）を選んで Store を作る
 */
import { type AppMiddleware, type AppStore, createStore } from "../redux/createStore.ts";
import { eventLog } from "../redux/middlewares/eventLog/index.ts";
import { agentsRequested, interruptionCheckRequested, livenessCheckRequested } from "../redux/modules/app/agents/slice.ts";

export { listen } from "../redux/createStore.ts";

/** ログからエージェントを組み立て、プロセスが消えたもの・中断されたものを片付ける（system と claude の middleware が要る） */
export function loadAgents(store: AppStore): AppStore {
  const at = Date.now();
  store.dispatch(agentsRequested());
  store.dispatch(livenessCheckRequested({ at }));
  store.dispatch(interruptionCheckRequested({ at }));
  return store;
}

/** 出来事を記録する Store（記録は reducer の直前、effects はその外側に組まれる） */
export const storeWith = (...effects: AppMiddleware[]) => createStore({ log: eventLog(), effects });
