/**
 * ペインへの移動。結果（直近の1件）を持ち、UI はこれを読んでメッセージを出す
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { JumpResult, JumpTarget } from "../../../domain/model.ts";

export interface NavigationState {
  lastJump: JumpResult | null;
}

export const navigation = createSlice({
  name: "navigation",
  initialState: { lastJump: null } as NavigationState,
  reducers: {
    jumped: (st, a: PayloadAction<JumpResult>) => void (st.lastJump = a.payload),
  },
});
export const { jumped } = navigation.actions;

/** 行の指す先の tmux ペインへ移動してほしい。見つからず create なら新しいウィンドウを開く。結果は jumped で戻る */
export const jumpRequested = createAction<{ target: JumpTarget; create: boolean; dryRun?: boolean }>("navigation/jumpRequested");
