/**
 * 状態の合成: 各モジュールの reducer を app（ドメイン）と ui（画面）にまとめる
 * selector はここの RootState を読む（Store の作り方は知らない）
 */
import { combineReducers } from "@reduxjs/toolkit";
import { agents } from "./modules/app/agents/slice.ts";
import { attention } from "./modules/app/attention/slice.ts";
import { lifecycle } from "./modules/app/lifecycle/slice.ts";
import { workspace } from "./modules/app/workspace/slice.ts";
import { visit } from "./modules/ui/visit/slice.ts";
import { watchView } from "./modules/ui/watch/slice.ts";

/** app: エージェント・人の対応・ワークスペース・いまの時刻 / ui: 画面の状態 */
export const rootReducer = combineReducers({
  app: combineReducers({
    agents: agents.reducer,
    attention: attention.reducer,
    workspace: workspace.reducer,
    lifecycle: lifecycle.reducer,
  }),
  ui: combineReducers({ visit: visit.reducer, watch: watchView.reducer }),
});

export type RootState = ReturnType<typeof rootReducer>;
