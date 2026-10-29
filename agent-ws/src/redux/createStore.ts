/**
 * Store を作る（ファクトリ。import しただけではインスタンスは作られない）
 *
 *   dispatch ─→ reducer ─→ listeners（登録した順）─→ subscribers
 *     listeners:   出来事に反応して外界とやりとりし、結果を出来事として戻す（RTK の listener middleware）。
 *                  いつ動くか（出来事の種類・読み直した出来事か・状態が変わったか）は actionCreator・matcher・predicate に書き、
 *                  effect の中で出来事を判断する if は書かない。どの listener を組むかはコマンドごとに commands が決める
 *     log:         記録（eventLog）の listener。ほかの listener より先に登録する。ほかの listener が出来事の途中で出した出来事
 *                  （表示中の完了の確認など）より先に記録しないと、ログの順序が入れ替わり、流し直したときの状態が変わってしまう
 *     subscribers: 状態を人に見せる（ui/subscribers のステータスライン・通知）。store.subscribe で、見ている部分が変わったときだけ動く
 *
 * 状態の形（rootReducer・RootState）は rootReducer.ts。modules（slice・selector）は I/O を知らない。thunk は使わない。
 */
import { addListener, configureStore, createListenerMiddleware, type Dispatch, type UnknownAction } from "@reduxjs/toolkit";
import { type RootState, rootReducer } from "./rootReducer.ts";

export type AppDispatch = Dispatch<UnknownAction>;

/** listener の effect が使う Store の窓口 */
export interface AppApi {
  dispatch: AppDispatch;
  getState: () => RootState;
}

/**
 * listener を登録する出来事（RTK の addListener を、この Store の状態とアクションの型にしたもの）。
 * listener の組は、これの並びとして書く。listener ごとの状態（見張り・debounce）は、組を作る関数の中に持つ。
 * 同じ条件で同じ effect の listener は1つにまとめられるので、effect は組を作るたびに作る（モジュールの定数を使い回さない）
 */
export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
export type AppListener = ReturnType<typeof addAppListener>;

export interface StoreParts {
  log?: AppListener[]; // 出来事の記録。ほかの listener より先に登録する
  listeners?: AppListener[]; // 外部システムとのやりとり
}

export function createStore({ log = [], listeners = [] }: StoreParts = {}) {
  const listener = createListenerMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    // 状態もアクションも素の JSON なので、開発時の検査は省く（hook の起動を軽くする）
    middleware: (defaults) => defaults({ thunk: false, serializableCheck: false, immutableCheck: false }).prepend(listener.middleware),
  });
  // 並べた順に登録する（listener は登録した順に呼ばれる）
  for (const add of [...log, ...listeners]) store.dispatch(add);
  return store;
}

export type AppStore = ReturnType<typeof createStore>;
