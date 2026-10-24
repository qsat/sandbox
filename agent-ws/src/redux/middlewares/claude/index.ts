/**
 * claude middleware: Claude Code とのやりとり（その形式を知っているのはここだけ）
 *
 * - hookReceived: hook の入力をエージェントの出来事に変えて流す。新しいエージェントなら本体の pid と場所を結びつける
 * - 起動したとき・時間が経ったとき: hook の届かない中断・拒否を会話ログから拾う
 *
 * hook の処理は、そのエージェントのこれまでの状態が Store にあることを前提にする（entry が先に initialized を出す）
 */
import { createAction } from "@reduxjs/toolkit";
import type { AppMiddleware } from "../../createStore.ts";
import { isBlocked, selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { type AgentEvent, agentAttached, agentEnded, turnInterrupted } from "../../modules/app/agents/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import type { Agent, Pid } from "../../types/agent.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { effects, on } from "../effects.ts";
import { inspect } from "../processes/proc.ts";
import { realPath } from "../shared/shell.ts";
import { type HookInput, toEvents } from "./hook.ts";
import { interruptedSince, tailSince } from "./transcript.ts";

/** Claude Code の hook が呼ばれた（input は stdin の JSON そのまま）。外から届いた合図で、どの reducer も扱わない */
export const hookReceived = createAction<{ input: unknown; at: number }>("claude/hookReceived");

/** プロセスの祖先（ps で1つずつ辿る。必要な分だけ） */
function* processAncestry(pid: Pid): Generator<{ pid: Pid; ppid: Pid; command: string }> {
  if (pid <= 1) return;
  const p = inspect(pid);
  if (!p) return;
  yield { pid, ...p };
  yield* processAncestry(p.ppid);
}

/** hook の祖先プロセスを辿って claude 本体の pid を探す */
const findAgentPid = (): Pid | null =>
  processAncestry(process.ppid)
    .take(6)
    .find((p) => detectAgent(p.command) === "claude")?.pid ?? null;

const cwdOf = (input: HookInput, known?: Agent) => {
  if (input.cwd) return realPath(input.cwd);
  return known?.cwd ?? "";
};

/** 本体の pid と場所・会話ログが、まだ分かっていなければ結びつける（終わるだけの hook では結びつけない） */
function attachment(input: HookInput, events: AgentEvent[], at: number, known?: Agent): AgentEvent[] {
  if (events.every((e) => agentEnded.match(e))) return [];
  if (known?.pid && (known.transcript || !input.transcript_path)) return [];
  const pid = known?.pid ?? findAgentPid();
  return [agentAttached({ agentId: input.session_id, at, pid, cwd: cwdOf(input, known), transcript: input.transcript_path })];
}

/** hook の届かない中断・拒否: 実行中・待ちのエージェントで、この状況になった後の会話ログに中断が書かれた */
function wasInterrupted(a: Agent): boolean {
  if (!a.transcript || (a.turn.status !== "running" && !isBlocked(a.turn.status))) return false;
  const tail = tailSince(a.transcript, a.turn.since);
  return Boolean(tail && interruptedSince(tail, a.turn.since));
}

export const claude = (): AppMiddleware =>
  effects((api) => [
    on(hookReceived, ({ payload: { input: raw, at } }) => {
      const input = raw as HookInput;
      const events = toEvents(input, at);
      const known = selectAgent(api.getState(), input.session_id);
      for (const e of [...attachment(input, events, at, known), ...events]) api.dispatch(e);
    }),
    on([initialized, ticked], ({ payload: { at } }) => {
      for (const a of selectAgents(api.getState()).filter(wasInterrupted)) api.dispatch(turnInterrupted({ agentId: a.id, at }));
    }),
  ]);
