import { homedir } from "node:os";
import { claude } from "../redux/middlewares/claude/index.ts";
import { system } from "../redux/middlewares/system/index.ts";
import { tmux } from "../redux/middlewares/tmux/index.ts";
import { agentListeners } from "../redux/modules/app/agents/listener.ts";
import { followStarted } from "../redux/modules/app/agents/slice.ts";
import { workspaceListeners } from "../redux/modules/app/workspace/listener.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import { reposRequested, scanStarted } from "../redux/modules/app/workspace/slice.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { visitRequested } from "../redux/modules/ui/visit/slice.ts";
import { selectWatchView } from "../redux/modules/ui/watch/selector.ts";
import { cursorSet, scrolled } from "../redux/modules/ui/watch/slice.ts";
import type { Filter } from "../redux/types/workspace.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { treeRows, visitMessage } from "../ui/view.ts";
import { runWatch as runTui } from "../ui/watch.ts";
import { listen, loadAgents, storeWith } from "./store.ts";

export function runWatch(o: { query?: string; filter: Filter; intervalMs: number; popup: boolean; color: ColorMode }): void {
  const store = loadAgents(storeWith(system(), claude(), tmux()));
  listen(store, agentListeners(), workspaceListeners());
  store.dispatch(reposRequested({ query: o.query }));
  runTui({
    rows: () => {
      const st = store.getState();
      return treeRows(selectTree(st, o.filter), { roots: selectRoots(st), home: homedir(), now: Date.now() });
    },
    view: () => {
      const st = store.getState();
      const last = selectLastVisit(st);
      return { ...selectWatchView(st), message: last ? visitMessage(last) : undefined };
    },
    subscribe: (onChange) => void store.subscribe(onChange),
    select: (key) => store.dispatch(cursorSet(key)),
    scroll: (top) => store.dispatch(scrolled(top)),
    visit: (target) => {
      store.dispatch(visitRequested({ target, create: true }));
      const r = selectLastVisit(store.getState());
      return r?.kind === "focused" || r?.kind === "created";
    },
    reload: () => store.dispatch(reposRequested({ query: o.query })),
    exitOnVisit: o.popup,
    color: o.color,
  });
  store.dispatch(followStarted({ intervalMs: o.intervalMs }));
  store.dispatch(scanStarted({ query: o.query, filter: o.filter, intervalMs: o.intervalMs }));
}
