/**
 * processes: OS のプロセスを調べる（listener）
 *
 * - processLiveness: 起動したとき・時間が経ったときに、プロセスが消えたエージェントを終わらせる
 * - processList: エージェントのプロセス一覧を持つ。起動したとき・時間が経ったとき・
 *   エージェントが増えた（pid がまだ一覧に無い）・消えたときに取り直す
 */

import { debounce } from "../../../lib/debounce.ts";
import type { AppApi, AppListener } from "../../createStore.ts";
import { selectAgentProcesses, selectAgents } from "../../modules/app/agents/selector.ts";
import { agentAttached, agentEnded, agentForgotten, agentProcessesScanned } from "../../modules/app/agents/slice.ts";
import { isStartOrTick } from "../../modules/app/lifecycle/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { AgentProcess, Pid } from "../../types/agent.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import * as proc from "./proc.ts";

/** SessionEnd はプロセスが終わる前に届くので、終わるのを待ってから取り直す */
const AFTER_END = 1_000;

/** ps に見えるエージェントのプロセス（自分自身は除く） */
function agentProcesses(self: Pid): AgentProcess[] {
  return proc.listProcesses().flatMap((p) => {
    const kind = detectAgent(p.command);
    if (!kind || !p.cwd || p.pid === self) return [];
    return [{ pid: p.pid, kind, cwd: p.cwd }];
  });
}

/** プロセスが消えたエージェントを終わらせる（起動したとき・時間が経ったとき） */
export const processLiveness = (): AppListener[] => [
  (start) =>
    start({
      matcher: isStartOrTick,
      effect: ({ payload: { at } }, api) => {
        const gone = selectAgents(api.getState()).filter((a) => a.pid && !proc.isAlive(a.pid));
        for (const a of gone) api.dispatch(agentEnded({ agentId: a.id, at }));
      },
    }),
];

/** そのエージェントの pid が、まだプロセス一覧に無い */
const notListed = (st: RootState, agentId: string) => {
  const pid = st.app.agents.byId[agentId]?.pid;
  return Boolean(pid) && !selectAgentProcesses(st).some((p) => p.pid === pid);
};

/**
 * エージェントのプロセス一覧を持つ（list・watch）。起動したとき・時間が経ったとき・
 * エージェントが増えた（pid がまだ一覧に無い）・消えたときに取り直す。self: このプロセス（一覧から除く）
 */
export function processList(o: { self: Pid }): AppListener[] {
  const scan = (api: AppApi) => void api.dispatch(agentProcessesScanned(agentProcesses(o.self)));
  // 出来事が続けて届いても、取り直しは1回にまとめる（消えたときは SessionEnd がプロセスの終了より先に届くので待つ）
  const rescan = (wait: number) => debounce(scan, wait);
  return [
    (start) => start({ matcher: isStartOrTick, effect: (_, api) => scan(api) }),
    (start) => {
      const later = rescan(AFTER_END);
      return start({ actionCreator: agentForgotten, effect: (_, api) => later(api) });
    },
    (start) => {
      const soon = rescan(0);
      return start({
        predicate: (action, current): action is ReturnType<typeof agentAttached> =>
          agentAttached.match(action) && notListed(current, action.payload.agentId),
        effect: (_, api) => soon(api),
      });
    },
  ];
}
