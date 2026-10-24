import { type AppListener, addAppListener } from "../../../createStore.ts";
import * as proc from "../../../infra/proc.ts";
import * as tmux from "../../../infra/tmux.ts";
import type { JumpResult } from "../../../types/navigation.ts";
import type { Pid } from "../../../types/workspace.ts";
import { findPane } from "../../../utils/findPane.ts";
import { seenInPaneRequested } from "../../app/sessions/slice.ts";
import { jumped, jumpRequested } from "./slice.ts";

const parentOf = () => {
  const ppid = new Map(proc.psTable().map((p) => [p.pid, p.ppid]));
  return (pid: Pid) => ppid.get(pid);
};

export const navigationListeners = (): AppListener[] => [
  addAppListener({
    actionCreator: jumpRequested,
    effect: ({ payload: { target: t, create, dryRun } }, api) => {
      const go = (): JumpResult => {
        const pane = findPane(t, tmux.listPanes(), parentOf());
        if (pane && dryRun) return { kind: "found", pane };
        if (pane) {
          if (!tmux.focusPane(pane.id)) return { kind: "failed", title: t.title };
          api.dispatch(seenInPaneRequested({ panePid: pane.pid, at: Date.now() }));
          return { kind: "focused", pane };
        }
        if (!create || !t.path || dryRun) return { kind: "notFound", title: t.title };
        const id = tmux.newWindow(t.path, t.name);
        return id && tmux.focusPane(id) ? { kind: "created", path: t.path } : { kind: "failed", title: t.title };
      };
      api.dispatch(jumped(go()));
    },
  }),
];
