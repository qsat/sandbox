/**
 * ペインへの移動の結果（直近の1件）。UI はこれを読んでメッセージを出す
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { JumpResult } from "./model.ts";

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
