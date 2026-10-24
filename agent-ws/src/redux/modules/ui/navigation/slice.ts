/**
 * ペインへの移動。結果（直近の1件）を持ち、UI はこれを読んでメッセージを出す
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { JumpResult, JumpTarget } from "../../../types/navigation.ts";
import { cursorSet } from "../watch/slice.ts";

export interface NavigationState {
  lastJump: JumpResult | null;
}

export const navigation = createSlice({
  name: "navigation",
  initialState: { lastJump: null } as NavigationState,
  reducers: {
    jumped: (st, a: PayloadAction<JumpResult>) => void (st.lastJump = a.payload),
  },
  // 選択を動かしたら、前の移動の結果は出さない
  extraReducers: (b) => b.addCase(cursorSet, (st) => void (st.lastJump = null)),
});
export const { jumped } = navigation.actions;

/** 行の指す先の tmux ペインへ移動してほしい。見つからず create なら新しいウィンドウを開く。結果は jumped で戻る */
export const jumpRequested = createAction<{ target: JumpTarget; create: boolean; dryRun?: boolean }>("navigation/jumpRequested");
