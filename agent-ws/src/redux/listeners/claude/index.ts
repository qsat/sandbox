/**
 * claude: Claude Code とのやりとり（その形式を知っているのはここだけ。listener）
 *
 * - claudeHooks: hook の入力をエージェントの出来事に変えて流す。新しいエージェントなら本体の pid と場所を結びつける
 * - interruptions: 起動したとき・時間が経ったときに、hook の届かない中断・拒否を会話ログから拾う
 * - transcriptWatch: 実行中・待ちのエージェントの会話ログを見張り、書き換わったらすぐ中断を確かめる（watch で組む。interval を待たない）
 *
 * hook の処理は、そのエージェントのこれまでの状態が Store にあることを前提にする（コマンドが先に initialized を出す）
 */
import { createAction } from "@reduxjs/toolkit";
import { debounce } from "../../../lib/debounce.ts";
import { realPath } from "../../../lib/run.ts";
import type { AppApi, AppListener } from "../../createStore.ts";
import { selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { type AgentEvent, agentAttached, agentEnded, turnInterrupted } from "../../modules/app/agents/slice.ts";
import { isStartOrTick } from "../../modules/app/lifecycle/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { Agent, Pid } from "../../types/agent.ts";
import { ancestry } from "../../utils/ancestry.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { isInTurn } from "../../utils/isInTurn.ts";
import { processTree } from "../processes/proc.ts";
import { type HookInput, toEvents } from "./hook.ts";
import { interruptedAt, tailSince, watchTranscript } from "./transcript.ts";

/** Claude Code の hook が呼ばれた（input は stdin の JSON そのまま）。外から届いた合図で、どの reducer も扱わない */
export const hookReceived = createAction<{ input: unknown; at: number }>("claude/hookReceived");

/** hook の祖先プロセスを辿って claude 本体の pid を探す（parent: hook を呼んだプロセス） */
function findAgentPid(parent: Pid): Pid | null {
  const tree = processTree();
  return ancestry(parent, tree.parentOf, 6).find((pid) => detectAgent(tree.commandOf(pid)) === "claude") ?? null;
}

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

/** hook の入力をエージェントの出来事に変えて流す。parent: このプロセスの親（その祖先に claude 本体がいる） */
export const claudeHooks = (o: { parent: Pid }): AppListener[] => [
  (start) =>
    start({
      actionCreator: hookReceived,
      effect: ({ payload: { input: raw, at } }, api) => {
        const input = raw as HookInput;
        const events = toEvents(input, at);
        const known = selectAgent(api.getState(), input.session_id);
        for (const e of [...attachment(input, events, at, o.parent, known), ...events]) api.dispatch(e);
      },
    }),
];

/** 中断を確かめる相手: 実行中・待ちで、会話ログの場所が分かっているエージェント */
const inTurn = (a: Agent): a is Agent & { transcript: string } => Boolean(a.transcript) && isInTurn(a.turn.status);

/** hook の届かない中断・拒否: この状況になった後の会話ログに中断が書かれていれば、その出来事 */
const interruptions = (agents: Agent[]) =>
  agents.filter(inTurn).flatMap((a) => {
    const tail = tailSince(a.transcript, a.turn.since);
    const at = tail && interruptedAt(tail, a.turn.since);
    if (!at) return [];
    return [turnInterrupted({ agentId: a.id, at })];
  });

const interrupt = (api: AppApi, agents: Agent[]) => {
  for (const e of interruptions(agents)) api.dispatch(e);
};

/** 起動したとき・時間が経ったときに、hook の届かない中断・拒否を会話ログから拾う */
export const interruptionChecks = (): AppListener[] => [
  (start) => start({ matcher: isStartOrTick, effect: (_, api) => interrupt(api, selectAgents(api.getState())) }),
];

/** 見張る会話ログ（会話ログのパス → エージェント）。実行中・待ちのエージェントから決まる */
const watchedOf = (st: RootState) =>
  new Map(
    selectAgents(st)
      .filter(inTurn)
      .map((a) => [a.transcript, a.id]),
  );
const keyOf = (watched: Map<string, string>) => [...watched].join("\n");

/** 実行中・待ちのエージェントの会話ログを見張り、書き換わったらすぐ中断を確かめる（見張る相手が変わったときだけ動く） */
export function transcriptWatch(): AppListener[] {
  /** 会話ログのパス → 見張りを止める */
  const watching = new Map<string, () => void>();
  /** 見張る会話ログを、いまの状態に合わせる */
  const follow = (api: AppApi) => {
    const wanted = watchedOf(api.getState());
    for (const path of [...watching.keys()].filter((p) => !wanted.has(p))) {
      watching.get(path)?.();
      watching.delete(path);
    }
    for (const [path, id] of [...wanted].filter(([p]) => !watching.has(p))) {
      const check = () =>
        interrupt(
          api,
          [selectAgent(api.getState(), id)].filter((a) => a !== undefined),
        );
      watching.set(path, watchTranscript(path, debounce(check, 50))); // 続けて書かれたらまとめて確かめる
    }
  };
  return [
    (start) =>
      start({
        predicate: (_, current, original) => keyOf(watchedOf(current)) !== keyOf(watchedOf(original)),
        effect: (_, api) => follow(api),
      }),
  ];
}
