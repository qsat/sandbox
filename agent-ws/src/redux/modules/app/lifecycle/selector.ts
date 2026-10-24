import type { RootState } from "../../../createStore.ts";

/** いまの時刻（最後に起動した・時間が経った時刻） */
export const selectNow = (st: RootState) => st.app.lifecycle.now;
