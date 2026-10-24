/**
 * Store を作る（ファクトリ。import しただけではインスタンスは作られない）
 *
 *   dispatch ─→ middleware ─┬→ listener（各モジュールの listener.ts。entry が必要な分だけ addAppListener で登録する）
 *                           └→ persistence（セッションのアクションをログに追記）
 *
 * reducer と middleware は全コマンド共通。listener はコマンドによって要らない・困るもの
 * （status から tmux を再描画させる、hook 以外で通知するなど）があるので、ここでは登録しない。
 * thunk は使わない（I/O はすべて listener が受け持ち、結果をアクションで戻す）。
 */
import { addListener, combineReducers, configureStore, createListenerMiddleware, type Dispatch, type UnknownAction } from "@reduxjs/toolkit";
import { persistence } from "./middlewares/persistence.ts";
import { navigation } from "./modules/navigation/slice.ts";
import { sessionsReducer } from "./modules/sessions/slice.ts";
import { workspace } from "./modules/workspace/slice.ts";

const rootReducer = combineReducers({ sessions: sessionsReducer, workspace: workspace.reducer, navigation: navigation.reducer });

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = Dispatch<UnknownAction>;

/** 型付きの listener 登録アクション。各モジュールの listener.ts はこれを返し、entry が dispatch する */
export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
export type AppListener = ReturnType<typeof addAppListener>;

export function createStore() {
  return configureStore({
    reducer: rootReducer,
    // 状態もアクションも素の JSON なので、開発時の検査は省く（hook の起動を軽くする）
    middleware: (defaults) =>
      defaults({ thunk: false, serializableCheck: false, immutableCheck: false })
        .prepend(createListenerMiddleware().middleware)
        .concat(persistence),
  });
}

export type AppStore = ReturnType<typeof createStore>;

/** listener を登録する（store 初期化のときに entry から呼ぶ） */
export function listen(store: AppStore, ...groups: AppListener[][]): void {
  for (const a of groups.flat()) store.dispatch(a);
}
