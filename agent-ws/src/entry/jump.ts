import { tmux } from "../redux/middlewares/tmux/index.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { destinationChosen } from "../redux/modules/ui/visit/slice.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import { type ColorMode, formatCells } from "../ui/terminal.ts";
import { visitMessage } from "../ui/view.ts";
import { start } from "./store.ts";

export interface JumpOptions {
  arg?: string;
  create: boolean;
  dryRun: boolean;
  color: ColorMode;
}

/** 人が行き先を選んだことを伝え、移動の結果（状態）を文字にする */
export function jump(o: JumpOptions): { text: string; ok: boolean } {
  const target: VisitTarget = /^\d+$/.test(o.arg ?? "")
    ? { title: `pid ${o.arg}`, name: `pid ${o.arg}`, pid: Number(o.arg) }
    : { title: o.arg ?? ".", name: o.arg ?? ".", path: o.arg ?? process.cwd() };
  const store = start([tmux()]);
  store.dispatch(destinationChosen({ target, create: o.create, dryRun: o.dryRun }));
  const r = selectLastVisit(store.getState()) ?? { kind: "failed", title: target.title };
  return { text: formatCells([visitMessage(r)], o.color), ok: r.kind !== "notFound" && r.kind !== "failed" };
}

/** 移動できたら true */
export function runJump(o: JumpOptions): boolean {
  const { text, ok } = jump(o);
  console.log(text);
  return ok;
}
