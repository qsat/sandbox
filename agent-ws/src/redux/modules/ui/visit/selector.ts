import type { RootState } from "../../../createStore.ts";

export const selectLastVisit = (st: RootState) => st.ui.visit.last;
