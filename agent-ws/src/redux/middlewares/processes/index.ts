/**
 * processes middleware: OS のプロセスを調べる
 *
 * - 起動したとき・時間が経ったとき: プロセスが消えたエージェントを終わらせる
 * - list のとき: エージェントのプロセス一覧を持つ。起動したとき・時間が経ったとき・
 *   エージェントが増えた（pid がまだ一覧に無い）・消えたときに取り直す
 */
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgentProcesses, selectAgents } from "../../modules/app/agents/selector.ts";
import { agentAttached, agentEnded, agentForgotten, agentProcessesScanned } from "../../modules/app/agents/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import type { AgentProcess } from "../../types/agent.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import * as proc from "./proc.ts";

/** SessionEnd はプロセスが終わる前に届くので、終わるのを待ってから取り直す */
const AFTER_END = 1_000;

/** ps に見えるエージェントのプロセス（自分自身は除く） */
function agentProcesses(): AgentProcess[] {
  return proc.listProcesses().flatMap((p) => {
    const kind = detectAgent(p.command);
    return kind && p.cwd && p.pid !== process.pid ? [{ pid: p.pid, kind, cwd: p.cwd }] : [];
  });
}

export const processes =
  (o: { list?: boolean } = {}): AppMiddleware =>
  (api) => {
    let rescanQueued = false;
    const scan = () => api.dispatch(agentProcessesScanned(agentProcesses()));
    /** 出来事が続けて届いても、取り直しは1回にまとめる */
    const rescanSoon = (delayMs: number) => {
      if (rescanQueued) return;
      rescanQueued = true;
      setTimeout(() => {
        rescanQueued = false;
        scan();
      }, delayMs);
    };

    return (next) => (action) => {
      const result = next(action);
      if (initialized.match(action) || ticked.match(action)) {
        for (const a of selectAgents(api.getState())) {
          if (a.pid && !proc.isAlive(a.pid)) api.dispatch(agentEnded({ agentId: a.id, at: action.payload.at }));
        }
        if (o.list) scan();
      } else if (o.list && agentForgotten.match(action)) {
        rescanSoon(AFTER_END);
      } else if (o.list && agentAttached.match(action)) {
        const st = api.getState();
        const pid = st.app.agents.byId[action.payload.agentId]?.pid;
        if (pid && !selectAgentProcesses(st).some((p) => p.pid === pid)) rescanSoon(0);
      }
      return result;
    };
  };
