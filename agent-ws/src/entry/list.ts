import { homedir } from "node:os";
import { claude } from "../redux/middlewares/claude/index.ts";
import { git } from "../redux/middlewares/git/index.ts";
import { processes } from "../redux/middlewares/processes/index.ts";
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import type { Filter } from "../redux/types/workspace.ts";
import { type ColorMode, formatRow } from "../ui/terminal.ts";
import { treeRows } from "../ui/view.ts";
import { start } from "./store.ts";

export interface ListOptions {
  query?: string;
  filter: Filter;
  json: boolean;
  color: ColorMode;
  width: number;
}

export function listText(o: ListOptions): string {
  const store = start([processes({ list: true }), git({ repos: { query: o.query }, dirty: o.filter }), claude()]);
  const st = store.getState();
  const repos = selectTree(st, o.filter);
  if (o.json) return JSON.stringify(repos, null, 2);
  return treeRows(repos, { roots: selectRoots(st), home: homedir(), now: selectNow(st) })
    .map((row) => formatRow(row, o.width, o.color))
    .join("\n");
}

export function runList(o: Omit<ListOptions, "width">): void {
  console.log(listText({ ...o, width: process.stdout.columns ?? 160 }));
}
