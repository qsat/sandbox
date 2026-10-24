/**
 * watch（常駐表示）の画面: 人が選んだ行と、popup で開いたか
 * 行そのものは状態から毎回組み立てるので持たない。行は key で指す。
 * 実際に選択中として出す行・スクロール位置は、行の並びと画面の高さから描画のたびに導く
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface WatchViewState {
  cursor: string | null; // 人が選んだ行の key（その行が消えていれば、描画では優先度の高い行を選ぶ）
  popup: boolean; // display-popup の中で開いた（移動できたら閉じる）
}

/** watch の画面を開いた */
export const watchOpened = createAction<{ popup: boolean }>("ui/watch/opened");

export const watchView = createSlice({
  name: "ui/watch",
  initialState: { cursor: null, popup: false } as WatchViewState,
  reducers: {
    /** 人が行を選んだ */
    rowSelected: (st, a: PayloadAction<string | null>) => {
      st.cursor = a.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(watchOpened, (st, { payload }) => {
      st.popup = payload.popup;
    });
  },
});
export const { rowSelected } = watchView.actions;

/** 人が r キーで読み直しを頼んだ */
export const reloadPressed = createAction("ui/watch/reloadPressed");
