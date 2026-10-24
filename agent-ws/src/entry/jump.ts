import { system } from "../redux/middlewares/system/index.ts";
import { tmux } from "../redux/middlewares/tmux/index.ts";
import { agentsRequested } from "../redux/modules/app/agents/slice.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { visitRequested } from "../redux/modules/ui/visit/slice.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import { type ColorMode, formatCells } from "../ui/terminal.ts";
import { visitMessage } from "../ui/view.ts";
import { storeWith } from "./store.ts";

/** 移動できたら true */
export function runJump(o: { arg?: string; create: boolean; dryRun: boolean; color: ColorMode }): boolean {
  const target: VisitTarget = /^\d+$/.test(o.arg ?? "")
    ? { title: `pid ${o.arg}`, name: `pid ${o.arg}`, pid: Number(o.arg) }
    : { title: o.arg ?? ".", name: o.arg ?? ".", path: o.arg ?? process.cwd() };
  const store = storeWith(system(), tmux());
  store.dispatch(agentsRequested());
  store.dispatch(visitRequested({ target, create: o.create, dryRun: o.dryRun }));
  const r = selectLastVisit(store.getState()) ?? { kind: "failed", title: target.title };
  console.log(formatCells([visitMessage(r)], o.color));
  return r.kind !== "notFound" && r.kind !== "failed";
}
