/**
 * claude middleware: Claude Code とのやりとり（その形式を知っているのはここだけ）
 *
 * - hookReceived: hook の入力をエージェントの出来事に変えて流す。新しいエージェントなら本体の pid と場所を結びつける
 * - interruptionCheckRequested: hook の届かない中断・拒否を会話ログから拾う
 */
import { createAction } from "@reduxjs/toolkit";
import type { AppMiddleware } from "../../createStore.ts";
import { isBlocked, selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { agentAttached, agentEnded, agentsRequested, interruptionCheckRequested, turnInterrupted } from "../../modules/app/agents/slice.ts";
import type { Pid } from "../../types/agent.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { inspect } from "../system/proc.ts";
import { realPath } from "../system/shell.ts";
import { type HookInput, toEvents } from "./hook.ts";
import { interruptedSince, tailSince } from "./transcript.ts";

/** Claude Code の hook が呼ばれた（input は stdin の JSON そのまま） */
export const hookReceived = createAction<{ input: unknown; at: number }>("claude/hookReceived");

/** hook の祖先プロセスを辿って claude 本体の pid を探す */
function findAgentPid(): Pid | null {
  for (let pid = process.ppid, i = 0; pid > 1 && i < 6; i++) {
    const p = inspect(pid);
    if (!p) break;
    if (detectAgent(p.command) === "claude") return pid;
    pid = p.ppid;
  }
  return null;
}

export const claude = (): AppMiddleware => (api) => (next) => (action) => {
  const result = next(action);
  if (hookReceived.match(action)) {
    const input = action.payload.input as HookInput;
    const at = action.payload.at;
    const events = toEvents(input, at);
    if (!events.length) return result;
    const agentId = input.session_id;
    api.dispatch(agentsRequested({ ids: [agentId] }));
    const known = selectAgent(api.getState(), agentId);
    const onlyEnd = events.every((e) => agentEnded.match(e));
    if (!onlyEnd && (!known?.pid || (input.transcript_path && !known.transcript))) {
      const cwd = input.cwd ? realPath(input.cwd) : (known?.cwd ?? "");
      api.dispatch(agentAttached({ agentId, at, pid: known?.pid ?? findAgentPid(), cwd, transcript: input.transcript_path }));
    }
    for (const e of events) api.dispatch(e);
  } else if (interruptionCheckRequested.match(action)) {
    for (const a of selectAgents(api.getState())) {
      if (!a.transcript || (a.turn.status !== "running" && !isBlocked(a.turn.status))) continue;
      const tail = tailSince(a.transcript, a.turn.since);
      if (tail && interruptedSince(tail, a.turn.since)) api.dispatch(turnInterrupted({ agentId: a.id, at: action.payload.at }));
    }
  }
  return result;
};
