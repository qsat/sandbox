/**
 * アプリの出来事: 起動した・時間が経った。いまの時刻もここで持つ
 * 時刻は出来事からだけ受け取る（描画も middleware も、現在時刻を自分で取らずにここを読む）
 */
import { createAction, createReducer } from "@reduxjs/toolkit";

/** コマンドが起動した */
export const initialized = createAction<{ at: number }>("app/initialized");
/** 時間が経った（watch で clock の middleware が interval ごとに出す） */
export const ticked = createAction<{ at: number }>("app/ticked");

export interface LifecycleState {
  now: number; // 最後に起動した・時間が経った時刻
}

export const lifecycleReducer = createReducer({ now: 0 } as LifecycleState, (b) => {
  b.addCase(initialized, (st, { payload }) => {
    st.now = payload.at;
  });
  b.addCase(ticked, (st, { payload }) => {
    st.now = payload.at;
  });
});
