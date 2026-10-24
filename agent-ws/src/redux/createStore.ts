/**
 * Store を作る（ファクトリ。import しただけではインスタンスは作られない）
 *
 *   dispatch ─→ listener ─→ effects ─→ log ─→ reducer
 *     listener: 時間の経過を待つなど I/O を伴わないつなぎ（要るモジュールにだけある）
 *     effects:  entry が選んだ middleware（claude・processes・git・tmux・notifier・clock）。出来事に反応して I/O し、結果を出来事として戻す
 *     log:      出来事の記録（eventLog）。reducer の直前に置く。effects が出来事の途中で出した出来事（表示中の完了の確認など）
 *               より先に記録しないと、ログの順序が入れ替わり、流し直したときの状態が変わってしまう
 *
 * modules（slice・selector・listener）は I/O を知らない。どの middleware を組むかはコマンドごとに entry が決める
 * （status から tmux を再描画させない、通知は hook だけ、など）。thunk は使わない。
 */
import {
  addListener,
  combineReducers,
  configureStore,
  createListenerMiddleware,
  type Dispatch,
  type Middleware,
  type UnknownAction,
} from "@reduxjs/toolkit";
import { agentsReducer } from "./modules/app/agents/slice.ts";
import { attentionReducer } from "./modules/app/attention/slice.ts";
import { lifecycleReducer } from "./modules/app/lifecycle/slice.ts";
import { workspace } from "./modules/app/workspace/slice.ts";
import { visit } from "./modules/ui/visit/slice.ts";
import { watchView } from "./modules/ui/watch/slice.ts";

/** app: エージェント・人の対応・ワークスペース・いまの時刻 / ui: 画面の状態 */
export const rootReducer = combineReducers({
  app: combineReducers({ agents: agentsReducer, attention: attentionReducer, workspace: workspace.reducer, lifecycle: lifecycleReducer }),
  ui: combineReducers({ visit: visit.reducer, watch: watchView.reducer }),
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = Dispatch<UnknownAction>;
export type AppMiddleware = Middleware<unknown, RootState, AppDispatch>;

/** 型付きの listener 登録アクション。各モジュールの listener.ts はこれを返し、entry が dispatch する */
export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
export type AppListener = ReturnType<typeof addAppListener>;

export interface StoreParts {
  log?: AppMiddleware; // 出来事の記録。reducer の直前に組む
  effects?: AppMiddleware[]; // 外部システムとのやりとり
}

export function createStore({ log, effects = [] }: StoreParts = {}) {
  return configureStore({
    reducer: rootReducer,
    // 状態もアクションも素の JSON なので、開発時の検査は省く（hook の起動を軽くする）
    middleware: (defaults) =>
      defaults({ thunk: false, serializableCheck: false, immutableCheck: false })
        .prepend(createListenerMiddleware().middleware)
        .concat(...effects, ...(log ? [log] : [])),
  });
}

export type AppStore = ReturnType<typeof createStore>;

/** listener を登録する（store 初期化のときに entry から呼ぶ） */
export function listen(store: AppStore, ...groups: AppListener[][]): void {
  for (const a of groups.flat()) store.dispatch(a);
}
