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
import { effects, on } from "../effects.ts";
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

export const processes = (o: { list?: boolean } = {}): AppMiddleware =>
  effects((api) => {
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

    return [
      on([initialized, ticked], ({ payload: { at } }) => {
        for (const a of selectAgents(api.getState())) {
          if (a.pid && !proc.isAlive(a.pid)) api.dispatch(agentEnded({ agentId: a.id, at }));
        }
        if (o.list) scan();
      }),
      on(agentForgotten, () => {
        if (o.list) rescanSoon(AFTER_END);
      }),
      // エージェントが増えて、その pid がまだ一覧に無い
      on(agentAttached, ({ payload }) => {
        const st = api.getState();
        const pid = st.app.agents.byId[payload.agentId]?.pid;
        if (o.list && pid && !selectAgentProcesses(st).some((p) => p.pid === pid)) rescanSoon(0);
      }),
    ];
  });
