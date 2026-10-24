import type { RootState } from "../redux/createStore.ts";
import { selectStatusFlags } from "../redux/modules/app/attention/selector.ts";
import { type ColorMode, formatCells } from "./terminal.ts";
import { statusLine } from "./view.ts";

/** ステータスラインの印（対応が要るものの有無だけ） */
export const statusText = (st: RootState, color: ColorMode): string => formatCells(statusLine(selectStatusFlags(st)), color);
