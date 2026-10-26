/**
 * claude middleware: Claude Code とのやりとり（その形式を知っているのはここだけ）
 *
 * - hookReceived: hook の入力をエージェントの出来事に変えて流す。新しいエージェントなら本体の pid と場所を結びつける
 * - 起動したとき・時間が経ったとき: hook の届かない中断・拒否を会話ログから拾う
 * - follow のとき: 実行中・待ちのエージェントの会話ログを見張り、書き換わったらすぐ中断を確かめる（watch。interval を待たない）
 *
 * hook の処理は、そのエージェントのこれまでの状態が Store にあることを前提にする（entry が先に initialized を出す）
 */
import { createAction } from "@reduxjs/toolkit";
import { debounce } from "../../../lib/debounce.ts";
import { realPath } from "../../../lib/run.ts";
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { type AgentEvent, agentAttached, agentEnded, turnInterrupted } from "../../modules/app/agents/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import type { Agent, Pid } from "../../types/agent.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { isBlocked } from "../../utils/isBlocked.ts";
import { always, effects, on } from "../effects.ts";
import { inspect } from "../processes/proc.ts";
import { type HookInput, toEvents } from "./hook.ts";
import { interruptedAt, tailSince, watchTranscript } from "./transcript.ts";

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

/** hook の祖先プロセスを辿って claude 本体の pid を探す（parent: hook を呼んだプロセス） */
const findAgentPid = (parent: Pid): Pid | null =>
  processAncestry(parent)
    .take(6)
    .find((p) => detectAgent(p.command) === "claude")?.pid ?? null;

const cwdOf = (input: HookInput, known?: Agent) => {
  if (input.cwd) return realPath(input.cwd);
  return known?.cwd ?? "";
};

/** 本体の pid と場所・会話ログが、まだ分かっていなければ結びつける（終わるだけの hook では結びつけない） */
function attachment(input: HookInput, events: AgentEvent[], at: number, parent: Pid, known?: Agent): AgentEvent[] {
  if (events.every((e) => agentEnded.match(e))) return [];
  if (known?.pid && (known.transcript || !input.transcript_path)) return [];
  const pid = known?.pid ?? findAgentPid(parent);
  return [agentAttached({ agentId: input.session_id, at, pid, cwd: cwdOf(input, known), transcript: input.transcript_path })];
}

/** 中断を確かめる相手: 実行中・待ちで、会話ログの場所が分かっているエージェント */
const inTurn = (a: Agent): a is Agent & { transcript: string } =>
  Boolean(a.transcript) && (a.turn.status === "running" || isBlocked(a.turn.status));

/** hook の届かない中断・拒否: この状況になった後の会話ログに中断が書かれていれば、その時刻 */
function interruptionOf(a: Agent): number | null {
  if (!inTurn(a)) return null;
  const tail = tailSince(a.transcript, a.turn.since);
  if (!tail) return null;
  return interruptedAt(tail, a.turn.since);
}

export interface ClaudeOptions {
  parent: Pid; // このプロセスの親（hook なら、その祖先に claude 本体がいる）
  follow?: boolean; // 実行中・待ちのエージェントの会話ログを見張る（watch）
}

export const claude = (o: ClaudeOptions): AppMiddleware =>
  effects((api) => {
    const interrupt = (a: Agent) => {
      const at = interruptionOf(a);
      if (at !== null) api.dispatch(turnInterrupted({ agentId: a.id, at }));
    };
    /** 会話ログのパス → 見張りを止める */
    const watching = new Map<string, () => void>();
    /** 見張る会話ログを、いまの状態（実行中・待ちのエージェント）に合わせる */
    const follow = () => {
      const wanted = new Map(
        selectAgents(api.getState())
          .filter(inTurn)
          .map((a) => [a.transcript, a.id]),
      );
      for (const path of [...watching.keys()].filter((p) => !wanted.has(p))) {
        watching.get(path)?.();
        watching.delete(path);
      }
      for (const [path, id] of [...wanted].filter(([p]) => !watching.has(p))) {
        const check = () => {
          const a = selectAgent(api.getState(), id);
          if (a) interrupt(a);
        };
        watching.set(path, watchTranscript(path, debounce(check, 50))); // 続けて書かれたらまとめて確かめる
      }
    };

    return [
      on(hookReceived, ({ payload: { input: raw, at } }) => {
        const input = raw as HookInput;
        const events = toEvents(input, at);
        const known = selectAgent(api.getState(), input.session_id);
        for (const e of [...attachment(input, events, at, o.parent, known), ...events]) api.dispatch(e);
      }),
      on([initialized, ticked], () => {
        for (const a of selectAgents(api.getState())) interrupt(a);
      }),
      always(() => {
        if (o.follow) follow();
      }),
    ];
  });
