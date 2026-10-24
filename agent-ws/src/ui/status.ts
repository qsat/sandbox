/**
 * ステータスラインの印: 人の対応が要るものの有無だけ（中身はポップアップで見る）
 */
import { selectStatusFlags } from "../redux/modules/app/attention/selector.ts";
import type { RootState } from "../redux/rootReducer.ts";
import type { StatusFlags } from "../redux/types/attention.ts";
import { type Cell, cell, STATUS, when } from "./parts.ts";
import { type ColorMode, formatCells } from "./terminal.ts";

/** ステータスライン: 人の対応が要るものの有無だけ（中身はポップアップで見る） */
export const statusLine = (f: StatusFlags): Cell[] => [
  ...when(f.waiting, cell(STATUS.waiting.icon, "waiting")),
  ...when(f.asking, cell(STATUS.asking.icon, "asking")),
  ...when(f.unseen, cell(STATUS.done.icon, "ok")),
  ...when(f.error, cell(STATUS.error.icon, "error")),
];

export const statusText = (st: RootState, color: ColorMode): string => formatCells(statusLine(selectStatusFlags(st)), color);
