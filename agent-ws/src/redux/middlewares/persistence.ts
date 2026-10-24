/**
 * 永続化: セッションのアクションをセッションごとのログに追記する
 * 状態が変わらないものは残さない（流し直しても同じなので）。ended ならログごと消す
 */
import type { Middleware } from "@reduxjs/toolkit";
import * as eventLog from "../../infra/eventLog.ts";
import type { RootState } from "../createStore.ts";
import { ended, isSessionAction } from "../modules/sessions/slice.ts";

export const persistence: Middleware<{}, RootState> = (api) => (next) => (action) => {
  if (!isSessionAction(action)) return next(action);
  const id = action.payload.sessionId;
  const before = api.getState().sessions[id];
  const result = next(action);
  if (ended.match(action)) eventLog.remove(id);
  else if (api.getState().sessions[id] !== before) eventLog.append(id, action);
  return result;
};
