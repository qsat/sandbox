/**
 * Store: セッション（ログから組み立てる）とワークスペース（スキャン結果）
 *
 *   dispatch ─→ middleware ─┬→ listener（意図に反応した I/O・通知・ステータスラインの再描画・watch の定期スキャン）
 *                           └→ 永続化（セッションのアクションを、状態が変わったときだけログに追記）
 *   thunk は使わない（I/O はすべて listener が受け持ち、結果をアクションで戻す）
 */
import { configureStore, createListenerMiddleware, type Dispatch, type Middleware, type TypedStartListening, type UnknownAction } from "@reduxjs/toolkit";
import type { Notice } from "../domain/model.ts";
import { navigation, type NavigationState } from "../domain/navigation.ts";
import { ended, isSessionAction, sessionsReducer, type SessionsState } from "../domain/sessions.ts";
import { workspace, type WorkspaceState } from "../domain/workspace.ts";
import * as eventLog from "../infra/eventLog.ts";
import { registerListeners } from "./effects.ts";

export interface RootState {
  sessions: SessionsState;
  workspace: WorkspaceState;
  navigation: NavigationState;
}
export type AppDispatch = Dispatch<UnknownAction>;
export type AppStartListening = TypedStartListening<RootState, AppDispatch>;

/** セッションのアクションをログに残す。状態が変わらないものは残さない（流し直しても同じなので） */
const persistence: Middleware<{}, RootState> = (api) => (next) => (action) => {
  if (!isSessionAction(action)) return next(action);
  const id = action.payload.sessionId;
  const before = api.getState().sessions[id];
  const result = next(action);
  if (ended.match(action)) eventLog.remove(id);
  else if (api.getState().sessions[id] !== before) eventLog.append(id, action);
  return result;
};

export interface StoreOptions {
  onNotice?: (n: Notice) => void; // 人の注意が要る遷移が起きたとき（hook から使う）
}

export function createAppStore(o: StoreOptions = {}) {
  const listener = createListenerMiddleware();
  const store = configureStore({
    reducer: { sessions: sessionsReducer, workspace: workspace.reducer, navigation: navigation.reducer },
    // 状態もアクションも素の JSON なので、開発時の検査は省く（hook の起動を軽くする）
    middleware: (defaults) =>
      defaults({ thunk: false, serializableCheck: false, immutableCheck: false }).prepend(listener.middleware).concat(persistence),
  });
  registerListeners(listener.startListening as AppStartListening, o);
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
