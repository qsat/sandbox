import { basename } from "@herdr-tools/utils/basename";
import type { Locate } from "@herdr-tools/ws-core";
import type { TmuxFacts } from "./facts";

export function tmSessionName(worktreePath: string) {
  return basename(worktreePath).replace(/[.:]/g, "_");
}

export function sessionPaths(facts: TmuxFacts) {
  return facts.sessions.map((s) => s.path).filter(Boolean);
}

export function indexTmux(locate: Locate, facts: TmuxFacts) {
  const sessionsByWorktree = Map.groupBy(facts.sessions, (s) => locate(s.path)?.worktree.path);
  const livePanesByAgent = Map.groupBy(
    facts.panes.filter((p) => p.agentId && !p.dead),
    (p) => p.agentId,
  );
  const panesOf = (agentId: string) => livePanesByAgent.get(agentId) ?? [];
  return {
    facts,
    sessionOf: (worktreePath: string) => {
      const sessions = sessionsByWorktree.get(worktreePath) ?? [];
      return sessions.find((s) => s.name === tmSessionName(worktreePath)) ?? sessions[0];
    },
    panesOf,
    isAttached: (agentId: string) => panesOf(agentId).length > 0,
  };
}

export type TmuxIndex = ReturnType<typeof indexTmux>;
