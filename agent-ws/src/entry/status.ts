import { selectStatusFlags } from "../redux/modules/statusLine/selector.ts";
import { formatCells, type ColorMode } from "../ui/terminal.ts";
import { statusLine } from "../ui/view.ts";
import { sessionStore } from "./store.ts";

/** ステータスラインから呼ばれる。ここで tmux を描き直させると自分がまた呼ばれるので、statusLine の listener は登録しない */
export function runStatus(o: { color: ColorMode }): void {
  console.log(formatCells(statusLine(selectStatusFlags(sessionStore().getState())), o.color));
}
