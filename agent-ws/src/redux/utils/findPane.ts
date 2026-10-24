import type { Pid } from "../types/agent.ts";
import type { Pane, VisitTarget } from "../types/visit.ts";
import { ancestry } from "./ancestry.ts";
import { isUnder } from "./isUnder.ts";

/** pid の祖先を辿って pane_pid に行き着くペイン。なければ path 配下にいるペイン（完全一致・アクティブ優先） */
export function findPane(t: VisitTarget, panes: Pane[], parentOf: (pid: Pid) => Pid | undefined): Pane | undefined {
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  for (const pid of ancestry(t.pid, parentOf)) {
    const hit = byPid.get(pid);
    if (hit) return hit;
  }
  const path = t.path;
  if (!path) return undefined;
  const score = (p: Pane) => Number(p.path === path) * 2 + Number(p.active);
  return panes.filter((p) => isUnder(p.path, path)).sort((a, b) => score(b) - score(a))[0];
}
