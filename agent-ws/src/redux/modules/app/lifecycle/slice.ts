/**
 * アプリの出来事: 起動した・時間が経った。いまの時刻もここで持つ
 * 時刻は出来事からだけ受け取る（描画も listener も、現在時刻を自分で取らずにここを読む）
 */
import { createSlice, isAnyOf, type PayloadAction } from "@reduxjs/toolkit";

export interface LifecycleState {
  now: number; // 最後に起動した・時間が経った時刻
}

export const lifecycle = createSlice({
  name: "lifecycle",
  initialState: { now: 0 } as LifecycleState,
  reducers: {
    /** コマンドが起動した */
    initialized: (st, { payload }: PayloadAction<{ at: number }>) => {
      st.now = payload.at;
    },
    /** 時間が経った（watch で clock の listener が interval ごとに出す） */
    ticked: (st, { payload }: PayloadAction<{ at: number }>) => {
      st.now = payload.at;
    },
  },
});
export const { initialized, ticked } = lifecycle.actions;

/** 起動したか、時間が経った（その時点の外界を確かめるきっかけ） */
export const isStartOrTick = isAnyOf(initialized, ticked);
