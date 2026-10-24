import { homedir } from "node:os";
import { claude } from "../redux/middlewares/claude/index.ts";
import { system } from "../redux/middlewares/system/index.ts";
import { agentProcessesRequested } from "../redux/modules/app/agents/slice.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import { dirtyRequested, reposRequested } from "../redux/modules/app/workspace/slice.ts";
import type { Filter } from "../redux/types/workspace.ts";
import { type ColorMode, formatRow } from "../ui/terminal.ts";
import { treeRows } from "../ui/view.ts";
import { loadAgents, storeWith } from "./store.ts";

export function runList(o: { query?: string; filter: Filter; json: boolean; color: ColorMode }): void {
  const store = loadAgents(storeWith(system(), claude()));
  store.dispatch(reposRequested({ query: o.query }));
  store.dispatch(agentProcessesRequested());
  store.dispatch(dirtyRequested({ filter: o.filter }));
  const repos = selectTree(store.getState(), o.filter);
  if (o.json) {
    console.log(JSON.stringify(repos, null, 2));
    return;
  }
  for (const row of treeRows(repos, { roots: selectRoots(store.getState()), home: homedir(), now: Date.now() })) {
    console.log(formatRow(row, process.stdout.columns ?? 160, o.color));
  }
}
