import { claude } from "../redux/middlewares/claude/index.ts";
import { system } from "../redux/middlewares/system/index.ts";
import { selectStatusFlags } from "../redux/modules/app/attention/selector.ts";
import { type ColorMode, formatCells } from "../ui/terminal.ts";
import { statusLine } from "../ui/view.ts";
import { loadAgents, storeWith } from "./store.ts";

/** ステータスラインから呼ばれる。ここで tmux を描き直させると自分がまた呼ばれるので、tmux の middleware は組まない */
export function runStatus(o: { color: ColorMode }): void {
  const store = loadAgents(storeWith(system(), claude()));
  console.log(formatCells(statusLine(selectStatusFlags(store.getState())), o.color));
}
