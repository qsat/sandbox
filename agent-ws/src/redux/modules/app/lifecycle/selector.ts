import type { RootState } from "../../../rootReducer.ts";

/** いまの時刻（最後に起動した・時間が経った時刻） */
export const selectNow = (st: RootState) => st.app.lifecycle.now;
