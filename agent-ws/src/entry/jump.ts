import { tmux } from "../redux/middlewares/tmux/index.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { destinationChosen } from "../redux/modules/ui/visit/slice.ts";
import { statusLine } from "../redux/subscribers/statusLine.ts";
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

/** 数字なら pid、そうでなければパス（省くといまの場所） */
function targetOf(arg?: string): VisitTarget {
  if (arg && /^\d+$/.test(arg)) return { title: `pid ${arg}`, name: `pid ${arg}`, pid: Number(arg) };
  return { title: arg ?? ".", name: arg ?? ".", path: arg ?? process.cwd() };
}

/** 人が行き先を選んだことを伝え、移動の結果（状態）を文字にする */
export function jump(o: JumpOptions): { text: string; ok: boolean } {
  const target = targetOf(o.arg);
  const store = start([tmux()], { subscribers: [statusLine()] }); // 移動して確認したら印が変わる
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
