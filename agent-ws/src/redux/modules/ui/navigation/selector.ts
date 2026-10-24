import type { RootState } from "../../../createStore.ts";

export const selectLastJump = (st: RootState) => st.ui.navigation.lastJump;
