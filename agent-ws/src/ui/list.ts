/**
 * 一覧（list・watch）: 状態 → ツリーの行・文字
 */
import type { RootState } from "../redux/createStore.ts";
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import type { Filter } from "../redux/types/workspace.ts";
import { type Display, formatRow } from "./terminal.ts";
import { type Row, treeRows } from "./view.ts";

/** リポジトリ > worktree > エージェント > サブエージェント の行 */
export const listRows = (st: RootState, filter: Filter, home: string): Row[] =>
  treeRows(selectTree(st, filter), { roots: selectRoots(st), home, now: selectNow(st) });

export function listText(st: RootState, o: { filter: Filter; json: boolean }, d: Display): string {
  if (o.json) return JSON.stringify(selectTree(st, o.filter), null, 2);
  return listRows(st, o.filter, d.home)
    .map((row) => formatRow(row, d.width, d.color))
    .join("\n");
}
