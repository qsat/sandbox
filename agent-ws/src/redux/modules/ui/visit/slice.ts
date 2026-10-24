/**
 * エージェントや worktree の場所へ行く。結果（直近の1件）を持ち、UI はこれを読んでメッセージを出す
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Pid } from "../../../types/agent.ts";
import type { VisitResult, VisitTarget } from "../../../types/visit.ts";
import { rowSelected } from "../watch/slice.ts";

export interface VisitState {
  last: VisitResult | null;
}

export const visit = createSlice({
  name: "visit",
  initialState: { last: null } as VisitState,
  reducers: {
    /** 人が行き先を選んだ（create: 開いているペインが無ければ新しいウィンドウを開いてよい / dryRun: 探すだけ）。前の結果は消える */
    destinationChosen: (st, _: PayloadAction<{ target: VisitTarget; create: boolean; dryRun?: boolean }>) => {
      st.last = null;
    },
    /** 移動の結果 */
    visited: (st, a: PayloadAction<VisitResult>) => {
      st.last = a.payload;
    },
  },
  // 選択を動かしたら、前の移動の結果は出さない
  extraReducers: (b) => {
    b.addCase(rowSelected, (st) => {
      st.last = null;
    });
  },
});
export const { destinationChosen, visited } = visit.actions;

/** 人がそのペインにフォーカスした（どの reducer も扱わない合図。tmux の middleware が確認に変える）（tmux の pane-focus-in・移動の結果） */
export const paneFocused = createAction<{ panePid: Pid; at: number }>("visit/paneFocused");
