import { homedir } from "node:os";
import { ghqRoots } from "../redux/infra/git.ts";
import { followStarted } from "../redux/modules/app/sessions/slice.ts";
import { workspaceListeners } from "../redux/modules/app/workspace/listener.ts";
import { selectTree } from "../redux/modules/app/workspace/selector.ts";
import { reposRequested, scanStarted } from "../redux/modules/app/workspace/slice.ts";
import { navigationListeners } from "../redux/modules/ui/navigation/listener.ts";
import { selectLastJump } from "../redux/modules/ui/navigation/selector.ts";
import { jumpRequested } from "../redux/modules/ui/navigation/slice.ts";
import { selectWatchView } from "../redux/modules/ui/watch/selector.ts";
import { cursorSet, scrolled } from "../redux/modules/ui/watch/slice.ts";
import type { Filter } from "../redux/types/workspace.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { jumpMessage, treeRows } from "../ui/view.ts";
import { runWatch as runTui } from "../ui/watch.ts";
import { sessionStore } from "./store.ts";

export function runWatch(o: { query?: string; filter: Filter; intervalMs: number; popup: boolean; color: ColorMode }): void {
  const roots = ghqRoots();
  const store = sessionStore(workspaceListeners(), navigationListeners());
  runTui({
    rows: () => treeRows(selectTree(store.getState(), o.filter, process.pid), { compact: true, roots, home: homedir(), now: Date.now() }),
    view: () => {
      const st = store.getState();
      const jump = selectLastJump(st);
      return { ...selectWatchView(st), message: jump ? jumpMessage(jump) : undefined };
    },
    subscribe: (onChange) => void store.subscribe(onChange),
    select: (key) => store.dispatch(cursorSet(key)),
    scroll: (top) => store.dispatch(scrolled(top)),
    jump: (target) => {
      store.dispatch(jumpRequested({ target, create: true }));
      const r = selectLastJump(store.getState());
      return r?.kind === "focused" || r?.kind === "created";
    },
    reload: () => store.dispatch(reposRequested({ roots, query: o.query })),
    exitOnJump: o.popup,
    color: o.color,
  });
  store.dispatch(followStarted({ intervalMs: o.intervalMs }));
  store.dispatch(scanStarted({ roots, query: o.query, filter: o.filter, intervalMs: o.intervalMs }));
}
