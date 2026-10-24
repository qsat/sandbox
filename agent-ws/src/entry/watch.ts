import { homedir } from "node:os";
import { claude } from "../redux/middlewares/claude/index.ts";
import { clock } from "../redux/middlewares/clock/index.ts";
import { git } from "../redux/middlewares/git/index.ts";
import { processes } from "../redux/middlewares/processes/index.ts";
import { tmux } from "../redux/middlewares/tmux/index.ts";
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import { selectLastVisit } from "../redux/modules/ui/visit/selector.ts";
import { destinationChosen } from "../redux/modules/ui/visit/slice.ts";
import { selectShouldClose, selectWatchView } from "../redux/modules/ui/watch/selector.ts";
import { reloadPressed, rowSelected, watchOpened } from "../redux/modules/ui/watch/slice.ts";
import type { Filter } from "../redux/types/workspace.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { treeRows, visitMessage } from "../ui/view.ts";
import { runWatch as runTui } from "../ui/watch.ts";
import { start } from "./store.ts";

export interface WatchOptions {
  query?: string;
  filter: Filter;
  intervalMs: number;
  popup: boolean;
}

/** watch の Store: ログを追い続け、interval ごとにスキャンする */
export function watchStore(o: WatchOptions) {
  const store = start(
    [processes({ list: true }), git({ repos: { query: o.query }, dirty: o.filter }), claude(), tmux(), clock({ intervalMs: o.intervalMs })],
    { follow: true },
  );
  store.dispatch(watchOpened({ popup: o.popup }));
  return store;
}

export function runWatch(o: WatchOptions & { color: ColorMode }): void {
  const store = watchStore(o);
  runTui({
    rows: () => {
      const st = store.getState();
      return treeRows(selectTree(st, o.filter), { roots: selectRoots(st), home: homedir(), now: selectNow(st) });
    },
    view: () => {
      const st = store.getState();
      const last = selectLastVisit(st);
      return {
        cursor: selectWatchView(st).cursor,
        now: selectNow(st),
        message: last ? visitMessage(last) : undefined,
        close: selectShouldClose(st),
      };
    },
    subscribe: (onChange) => void store.subscribe(onChange),
    select: (key) => store.dispatch(rowSelected(key)),
    choose: (target) => store.dispatch(destinationChosen({ target, create: true })),
    reload: () => store.dispatch(reloadPressed()),
    color: o.color,
  });
}
