/**
 * watch（常駐表示）の画面の状態: 選択中の行とスクロール位置
 * 行そのものは状態から毎回組み立てるので持たない。行は key で指す
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface WatchViewState {
  cursor: string | null; // 選択中の行の key
  top: number; // スクロール位置（先頭に出す行の番号）
}

export const watchView = createSlice({
  name: "ui/watch",
  initialState: { cursor: null, top: 0 } as WatchViewState,
  reducers: {
    cursorSet: (st, a: PayloadAction<string | null>) => void (st.cursor = a.payload),
    scrolled: (st, a: PayloadAction<number>) => void (st.top = a.payload),
  },
});
export const { cursorSet, scrolled } = watchView.actions;
