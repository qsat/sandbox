import type { RootState } from "../../../rootReducer.ts";
import type { Agent } from "../../../types/agent.ts";

export const selectAgents = (st: RootState): Agent[] => Object.values(st.app.agents.byId);
export const selectAgent = (st: RootState, id: string): Agent | undefined => st.app.agents.byId[id];
export const selectAgentProcesses = (st: RootState) => st.app.agents.processes;

/** 表示するサブエージェント（完了したものは2分だけ残す） */
export const visibleSubagents = (a: Agent, now: number) =>
  Object.values(a.subagents)
    .filter((s) => s.status !== "done" || now - s.since < 2 * 60_000)
    .sort((x, y) => x.since - y.since);
