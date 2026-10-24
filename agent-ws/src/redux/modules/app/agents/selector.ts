import type { RootState } from "../../../createStore.ts";
import type { Agent, TurnStatus } from "../../../types/agent.ts";

export const selectAgents = (st: RootState): Agent[] => Object.values(st.app.agents.byId);
export const selectAgent = (st: RootState, id: string): Agent | undefined => st.app.agents.byId[id];
export const selectAgentProcesses = (st: RootState) => st.app.agents.processes;

/** 人の操作を待っている状況 */
export const isBlocked = (status: TurnStatus | undefined) => status === "waiting" || status === "asking";

/** 表示するサブエージェント（完了したものは2分だけ残す） */
export const visibleSubagents = (a: Agent, now: number) =>
  Object.values(a.subagents)
    .filter((s) => s.status !== "done" || now - s.since < 2 * 60_000)
    .sort((x, y) => x.since - y.since);
