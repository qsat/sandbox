/**
 * Store を作る（ファクトリ。import しただけではインスタンスは作られない）
 *
 *   dispatch ─→ listener ─→ effects ─→ log ─→ reducer ─→ subscribers
 *     listener:    時間の経過を待つなど I/O を伴わないつなぎ（要るモジュールにだけある）
 *     effects:     entry が選んだ middleware（claude・processes・git・tmux・clock）。出来事に反応して I/O し、結果を出来事として戻す
 *                  （middlewares/effects.ts の on で「出来事 → 反応」の対応表として書く）
 *     log:         出来事の記録（eventLog）。reducer の直前に置く。effects が出来事の途中で出した出来事（表示中の完了の確認など）
 *                  より先に記録しないと、ログの順序が入れ替わり、流し直したときの状態が変わってしまう
 *     subscribers: 状態を人に見せる（ui/subscribers のステータスライン・通知）。store.subscribe で、見ている部分が変わったときだけ動く。何も dispatch しない
 *
 * 状態の形（rootReducer・RootState）は rootReducer.ts。modules（slice・selector）は I/O を知らない。どの middleware・購読者を組むかはコマンドごとに entry が決める
 * （status からステータスラインを描き直させない、通知は hook だけ、など）。thunk は使わない。
 */
import {
  addListener,
  configureStore,
  createListenerMiddleware,
  type Dispatch,
  type Middleware,
  type UnknownAction,
} from "@reduxjs/toolkit";
import { type RootState, rootReducer } from "./rootReducer.ts";

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
        .concat(...effects, ...[log].filter((m) => m !== undefined)),
  });
}

export type AppStore = ReturnType<typeof createStore>;

/** listener を登録する（store 初期化のときに entry から呼ぶ） */
export function listen(store: AppStore, ...groups: AppListener[][]): void {
  for (const a of groups.flat()) store.dispatch(a);
}
