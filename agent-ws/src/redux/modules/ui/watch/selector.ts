import type { RootState } from "../../../createStore.ts";

export const selectWatchView = (st: RootState) => st.ui.watch;
