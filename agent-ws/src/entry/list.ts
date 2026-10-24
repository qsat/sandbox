import { homedir } from "node:os";
import { ghqRoots } from "../redux/infra/git.ts";
import { workspaceListeners } from "../redux/modules/app/workspace/listener.ts";
import { selectTree } from "../redux/modules/app/workspace/selector.ts";
import { dirtyRequested, processesRequested, reposRequested } from "../redux/modules/app/workspace/slice.ts";
import type { Filter } from "../redux/types/workspace.ts";
import { formatRow, type ColorMode } from "../ui/terminal.ts";
import { treeRows } from "../ui/view.ts";
import { sessionStore } from "./store.ts";

export function runList(o: { query?: string; filter: Filter; json: boolean; color: ColorMode }): void {
  const roots = ghqRoots();
  const store = sessionStore(workspaceListeners());
  store.dispatch(reposRequested({ roots, query: o.query }));
  store.dispatch(processesRequested());
  store.dispatch(dirtyRequested({ filter: o.filter }));
  const repos = selectTree(store.getState(), o.filter, process.pid);
  if (o.json) return console.log(JSON.stringify(repos, null, 2));
  for (const row of treeRows(repos, { compact: false, roots, home: homedir(), now: Date.now() })) {
    console.log(formatRow(row, process.stdout.columns ?? 160, o.color));
  }
}
