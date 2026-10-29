/**
 * watch（常駐表示）の画面: 人が選んだ行・popup で開いたか・移動の結果を見せているか
 * 行そのものは状態から毎回組み立てるので持たない。行は key で指す。
 * 実際に選択中として出す行・スクロール位置は、行の並びと画面の高さから描画のたびに導く
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { visited } from "../visit/slice.ts";

export interface WatchViewState {
  cursor: string | null; // 人が選んだ行の key（その行が消えていれば、描画では優先度の高い行を選ぶ）
  popup: boolean; // display-popup の中で開いた（移動できたら閉じる）
  showsVisit: boolean; // 移動の結果を見せている（行を選び直したら消す）
}

export const watchView = createSlice({
  name: "ui/watch",
  initialState: { cursor: null, popup: false, showsVisit: false } as WatchViewState,
  reducers: {
    /** watch の画面を開いた */
    opened: (st, { payload }: PayloadAction<{ popup: boolean }>) => {
      st.popup = payload.popup;
    },
    /** 人が行を選んだ。前の移動の結果は出さない */
    rowSelected: (st, { payload }: PayloadAction<string | null>) => {
      st.cursor = payload;
      st.showsVisit = false;
    },
  },
  extraReducers: (b) => {
    b.addCase(visited, (st) => {
      st.showsVisit = true;
    });
  },
});
export const { opened: watchOpened, rowSelected } = watchView.actions;

/** 人が r キーで読み直しを頼んだ（どの reducer も扱わない合図。git の listener が取り直す） */
export const reloadPressed = createAction("ui/watch/reloadPressed");
