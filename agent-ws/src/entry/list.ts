import { homedir } from "node:os";
import { claude } from "../redux/middlewares/claude/index.ts";
import { system } from "../redux/middlewares/system/index.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import type { Filter } from "../redux/types/workspace.ts";
import { type ColorMode, formatRow } from "../ui/terminal.ts";
import { treeRows } from "../ui/view.ts";
import { start } from "./store.ts";

export function runList(o: { query?: string; filter: Filter; json: boolean; color: ColorMode }): void {
  const store = start([system({ processes: true, repos: { query: o.query }, dirty: o.filter }), claude()]);
  const repos = selectTree(store.getState(), o.filter);
  if (o.json) {
    console.log(JSON.stringify(repos, null, 2));
    return;
  }
  for (const row of treeRows(repos, { roots: selectRoots(store.getState()), home: homedir(), now: Date.now() })) {
    console.log(formatRow(row, process.stdout.columns ?? 160, o.color));
  }
}
