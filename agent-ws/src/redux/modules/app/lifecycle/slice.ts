/**
 * アプリの出来事: 起動した・時間が経った
 * 何をするかは出来事を受けた middleware がそれぞれ決める（ログの読み込み・生死の確認・スキャンなど）
 */
import { createAction } from "@reduxjs/toolkit";

/** コマンドが起動した */
export const initialized = createAction<{ at: number }>("app/initialized");
/** 時間が経った（watch で clock の middleware が interval ごとに出す） */
export const ticked = createAction<{ at: number }>("app/ticked");
