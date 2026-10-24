import type { JumpTarget } from "../domain/model.ts";
import { realPath } from "../infra/shell.ts";
import { navigationListeners } from "../redux/modules/navigation/listener.ts";
import { selectLastJump } from "../redux/modules/navigation/selector.ts";
import { jumpRequested } from "../redux/modules/navigation/slice.ts";
import { statusLineListeners } from "../redux/modules/statusLine/listener.ts";
import { formatCells, type ColorMode } from "../ui/terminal.ts";
import { jumpMessage } from "../ui/view.ts";
import { sessionStore } from "./store.ts";

/** 移動できたら true */
export function runJump(o: { arg?: string; create: boolean; dryRun: boolean; color: ColorMode }): boolean {
  const target: JumpTarget = /^\d+$/.test(o.arg ?? "")
    ? { title: `pid ${o.arg}`, name: `pid ${o.arg}`, pid: Number(o.arg) }
    : { title: o.arg ?? ".", name: o.arg ?? ".", path: realPath(o.arg ?? process.cwd()) };
  const store = sessionStore(navigationListeners(), statusLineListeners());
  store.dispatch(jumpRequested({ target, create: o.create, dryRun: o.dryRun }));
  const r = selectLastJump(store.getState()) ?? { kind: "failed", title: target.title };
  console.log(formatCells([jumpMessage(r)], o.color));
  return r.kind !== "notFound" && r.kind !== "failed";
}
