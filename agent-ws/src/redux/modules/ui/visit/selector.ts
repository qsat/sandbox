import type { RootState } from "../../../createStore.ts";

export const selectLastVisit = (st: RootState) => st.ui.visit.last;

/** 行き先に着いた（dry-run なら見つかった） */
export const selectArrived = (st: RootState) => ["found", "focused", "created"].includes(selectLastVisit(st)?.kind ?? "");
