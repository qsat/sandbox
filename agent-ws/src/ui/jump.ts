import type { RootState } from "../redux/createStore.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import { type ColorMode, formatCells } from "./terminal.ts";
import { visitMessage } from "./view.ts";

/** 移動の結果（結果が無ければ移動できなかった） */
export function jumpText(st: RootState, target: VisitTarget, color: ColorMode): string {
  const r = selectLastVisit(st) ?? { kind: "failed", title: target.title };
  return formatCells([visitMessage(r)], color);
}
