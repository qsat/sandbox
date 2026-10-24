import { homedir } from "node:os";
import { ghqRoots } from "../infra/git.ts";
import { navigationListeners } from "../redux/modules/navigation/listener.ts";
import { selectLastJump } from "../redux/modules/navigation/selector.ts";
import { jumpRequested } from "../redux/modules/navigation/slice.ts";
import { watchListeners } from "../redux/modules/watch/listener.ts";
import { watchStarted } from "../redux/modules/watch/slice.ts";
import { workspaceListeners } from "../redux/modules/workspace/listener.ts";
import { selectTree } from "../redux/modules/workspace/selector.ts";
import { reposRequested, type Filter } from "../redux/modules/workspace/slice.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { jumpMessage, treeRows } from "../ui/view.ts";
import { runWatch as runTui } from "../ui/watch.ts";
import { sessionStore } from "./store.ts";

export function runWatch(o: { query?: string; filter: Filter; intervalMs: number; popup: boolean; color: ColorMode }): void {
  const roots = ghqRoots();
  const store = sessionStore(workspaceListeners(), navigationListeners(), watchListeners());
  runTui({
    rows: () => treeRows(selectTree(store.getState(), o.filter, process.pid), { compact: true, roots, home: homedir(), now: Date.now() }),
    subscribe: (onChange) => void store.subscribe(onChange),
    jump: (target) => {
      store.dispatch(jumpRequested({ target, create: true }));
      const r = selectLastJump(store.getState()) ?? { kind: "failed", title: target.title };
      return { ok: r.kind === "focused" || r.kind === "created", message: jumpMessage(r) };
    },
    reload: () => store.dispatch(reposRequested({ roots, query: o.query })),
    exitOnJump: o.popup,
    color: o.color,
  });
  store.dispatch(watchStarted({ roots, query: o.query, filter: o.filter, intervalMs: o.intervalMs }));
}
