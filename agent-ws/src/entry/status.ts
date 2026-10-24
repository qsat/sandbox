import { claude } from "../redux/middlewares/claude/index.ts";
import { processes } from "../redux/middlewares/processes/index.ts";
import { selectStatusFlags } from "../redux/modules/app/attention/selector.ts";
import { type ColorMode, formatCells } from "../ui/terminal.ts";
import { statusLine } from "../ui/view.ts";
import { start } from "./store.ts";

/**
 * ステータスラインから呼ばれるので軽くする（プロセス一覧もリポジトリも調べず、生死の確認と中断の確認だけ）。
 * ここで tmux を描き直させると自分がまた呼ばれるので、tmux の middleware は組まない
 */
export function statusText(color: ColorMode): string {
  const store = start([processes(), claude()]);
  return formatCells(statusLine(selectStatusFlags(store.getState())), color);
}

export function runStatus(o: { color: ColorMode }): void {
  console.log(statusText(o.color));
}
