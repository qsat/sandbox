/**
 * エージェントや worktree の場所へ行く。結果（直近の1件）を持ち、UI はこれを読んでメッセージを出す
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Pid } from "../../../types/agent.ts";
import type { VisitResult, VisitTarget } from "../../../types/visit.ts";
import { cursorSet } from "../watch/slice.ts";

export interface VisitState {
  last: VisitResult | null;
}

export const visit = createSlice({
  name: "visit",
  initialState: { last: null } as VisitState,
  reducers: {
    visited: (st, a: PayloadAction<VisitResult>) => {
      st.last = a.payload;
    },
  },
  // 選択を動かしたら、前の移動の結果は出さない
  extraReducers: (b) => {
    b.addCase(cursorSet, (st) => {
      st.last = null;
    });
  },
});
export const { visited } = visit.actions;

/** そこへ行ってほしい。見つからず create なら新しいウィンドウを開く。結果は visited で戻る */
export const visitRequested = createAction<{ target: VisitTarget; create: boolean; dryRun?: boolean }>("visit/requested");
/** 人がそのペインにフォーカスした（tmux の pane-focus-in・移動の結果） */
export const paneFocused = createAction<{ panePid: Pid; at: number }>("visit/paneFocused");
