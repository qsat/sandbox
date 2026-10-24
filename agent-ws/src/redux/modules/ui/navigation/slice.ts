/**
 * ペインへの移動。結果（直近の1件）を持ち、UI はこれを読んでメッセージを出す
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Pid } from "../../app/workspace/slice.ts";
import { cursorSet } from "../watch/slice.ts";

/** tmux のペイン（エージェントが表示されている場所） */
export interface Pane {
  id: string; // %12
  pid: Pid; // ペインで最初に起動したプロセス（通常はシェル）
  session: string;
  window: string;
  windowName: string;
  path: string;
  active: boolean; // クライアントが接続しているセッションの、いま表示されているペイン
}

/** 移動先: pid（の祖先）がいるペイン、なければ path にいるペイン */
export interface JumpTarget {
  title: string;
  name: string; // 新しいウィンドウを開くときの名前
  pid?: Pid;
  path?: string;
}

export type JumpResult =
  | { kind: "focused" | "found"; pane: Pane } // found: dry-run
  | { kind: "created"; path: string }
  | { kind: "notFound" | "failed"; title: string };

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
