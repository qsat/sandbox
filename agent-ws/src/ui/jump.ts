/**
 * 移動の結果: どのペインへ移ったか・移れなかったか
 */
import { match } from "../lib/match.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import type { RootState } from "../redux/rootReducer.ts";
import type { VisitResult, VisitTarget } from "../redux/types/visit.ts";
import { type Cell, cell } from "./parts.ts";
import { type ColorMode, formatCells } from "./terminal.ts";

export function visitMessage(r: VisitResult): Cell {
  const pane = (p: { session: string; window: string; windowName: string; id: string }) =>
    `${p.session}:${p.window} (${p.windowName}) ${p.id}`;
  return match(r, {
    focused: (r) => cell(`→ ${pane(r.pane)}`, "ok"),
    found: (r) => cell(pane(r.pane)),
    created: (r) => cell(`→ 新しいウィンドウ ${r.path}`, "ok"),
    notFound: (r) => cell(`${r.title} を表示しているペインがありません`, "warn"),
    failed: (r) => cell(`${r.title} へ移動できませんでした（tmux クライアントの外？）`, "warn"),
  });
}

/** 移動の結果（結果が無ければ移動できなかった） */
export function jumpText(st: RootState, target: VisitTarget, color: ColorMode): string {
  const r = selectLastVisit(st) ?? { kind: "failed", title: target.title };
  return formatCells([visitMessage(r)], color);
}
