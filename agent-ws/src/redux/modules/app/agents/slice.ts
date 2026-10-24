/**
 * エージェント集約: エージェント1体の、いまのターンとサブエージェント
 *
 * 状態は出来事の積み重ねで決まる（エージェントごとのログに追記され、読むたびに流し直す）。
 * そのため reducer は純粋で、時刻も出来事の at だけを使う。状態が変わらない出来事は記録されない。
 * OS から見えるエージェントのプロセス（processes）は観測した「いまの値」で、ログには残さない。
 */
import { createAction, createReducer, isAnyOf, type PayloadActionCreator } from "@reduxjs/toolkit";
import type { Agent, AgentProcess, Pid, SubagentRef, SubagentStatus, TurnStatus } from "../../../types/agent.ts";
import { isBlocked } from "./selector.ts";

type On<T = unknown> = { agentId: string; at: number } & T;

// ---------------------------------------------------------------------
// 出来事（記録される）
// ---------------------------------------------------------------------
/** エージェントのプロセス・場所が分かった（新しいエージェントならここで生まれる） */
export const agentAttached = createAction<On<{ pid: Pid | null; cwd: string; transcript?: string }>>("agent/attached");
/** source: startup / resume / clear / compact */
export const agentStarted = createAction<On<{ source?: string }>>("agent/started");
export const turnStarted = createAction<On>("agent/turnStarted");
/** 人の入力を求めた（permission: 許可 / question: 質問への回答）。subagent からのこともある */
export const inputRequested =
  createAction<On<{ subagent?: SubagentRef; kind: "permission" | "question"; summary?: string }>>("agent/inputRequested");
export const toolUsed = createAction<On<{ subagent?: SubagentRef; tool: string }>>("agent/toolUsed");
/** ターンが終わった。background: バックグラウンドのサブエージェントが残っている（終われば自動で再開する） */
export const turnFinished = createAction<On<{ message?: string; background: boolean }>>("agent/turnFinished");
export const turnFailed = createAction<On<{ error?: string }>>("agent/turnFailed");
/** Esc での中断・許可の拒否 */
export const turnInterrupted = createAction<On>("agent/turnInterrupted");
export const subagentStarted = createAction<On<{ subagent: SubagentRef }>>("agent/subagentStarted");
export const subagentFinished = createAction<On<{ subagent: SubagentRef; message?: string }>>("agent/subagentFinished");
export const agentEnded = createAction<On>("agent/ended");

const agentEvents = [
  agentAttached,
  agentStarted,
  turnStarted,
  inputRequested,
  toolUsed,
  turnFinished,
  turnFailed,
  turnInterrupted,
  subagentStarted,
  subagentFinished,
  agentEnded,
] as const;
export type AgentEvent = ReturnType<(typeof agentEvents)[number]>;
export const isAgentEvent = isAnyOf(...agentEvents);

// ---------------------------------------------------------------------
// 記録されないアクション
// ---------------------------------------------------------------------
/** スナップショットから戻した（attention はその時点の確認状況） */
export const agentRestored = createAction<{ agent: Agent; attention: { unseen: boolean } }>("agent/restored");
/** 他のプロセスがログを消した */
export const agentForgotten = createAction<{ agentId: string }>("agent/forgotten");
export const agentProcessesScanned = createAction<AgentProcess[]>("agent/processesScanned");

// ---------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------
export interface AgentsState {
  byId: Record<string, Agent>;
  processes: AgentProcess[];
}

/** 値が変わるときだけ書く（同じ値の代入も「変更」にしないため。変わらない出来事はログに残さない） */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K]): void {
  if (o[k] === v) return;
  if (v === undefined) delete o[k];
  else o[k] = v;
}

function setTurn(a: Agent, status: TurnStatus, at: number, reason?: string): void {
  if (a.turn.status !== status) a.turn.since = at;
  put(a.turn, "status", status);
  put(a.turn, "reason", reason);
}

function setSubagent(a: Agent, ref: SubagentRef, status: SubagentStatus, at: number, detail?: string): void {
  a.subagents[ref.id] ??= { id: ref.id, type: ref.type, status, since: at };
  const s = a.subagents[ref.id];
  if (s.status !== status) s.since = at;
  put(s, "status", status);
  if (detail !== undefined) put(s, "detail", detail);
}

export const agentsReducer = createReducer({ byId: {}, processes: [] } as AgentsState, (b) => {
  /** 既知のエージェントに対してだけ適用する（必ず agentAttached が先に記録される） */
  const on = <P extends On>(event: PayloadActionCreator<P>, apply: (a: Agent, p: P) => unknown) =>
    b.addCase(event, (st, { payload }) => {
      const a = st.byId[payload.agentId];
      if (a) apply(a, payload);
    });

  b.addCase(agentAttached, (st, { payload: p }) => {
    const a = st.byId[p.agentId];
    if (!a) {
      st.byId[p.agentId] = {
        id: p.agentId,
        pid: p.pid,
        cwd: p.cwd,
        transcript: p.transcript,
        turn: { status: "ready", since: p.at },
        subagents: {},
      };
      return;
    }
    if (p.pid) put(a, "pid", p.pid);
    if (p.transcript) put(a, "transcript", p.transcript);
  });
  b.addCase(agentEnded, (st, { payload }) => {
    delete st.byId[payload.agentId];
  });
  b.addCase(agentForgotten, (st, { payload }) => {
    delete st.byId[payload.agentId];
  });
  b.addCase(agentRestored, (st, { payload }) => {
    st.byId[payload.agent.id] = structuredClone(payload.agent); // 凍結済みの状態が渡っても書き換えられるように
  });
  b.addCase(agentProcessesScanned, (st, { payload }) => {
    st.processes = payload;
  });

  // 圧縮（compact）後の SessionStart はターンの途中でも来るので状況を変えない
  on(agentStarted, (a, p) => p.source !== "compact" && setTurn(a, "ready", p.at));
  on(turnStarted, (a, p) => setTurn(a, "running", p.at));
  on(inputRequested, (a, p) => {
    if (p.subagent) setSubagent(a, p.subagent, "waiting", p.at, p.summary);
    else setTurn(a, p.kind === "question" ? "asking" : "waiting", p.at, p.summary);
  });
  on(toolUsed, (a, p) => {
    if (p.subagent) setSubagent(a, p.subagent, "running", p.at, p.tool);
    else setTurn(a, "running", p.at);
  });
  on(turnFinished, (a, p) => {
    setTurn(a, "ready", p.at, p.message);
    // バックグラウンドが残っていなければ、サブエージェントはすべて終わっている
    if (p.background) return;
    for (const s of Object.values(a.subagents)) {
      if (s.status === "done") continue;
      s.status = "done";
      s.since = p.at;
    }
  });
  on(turnFailed, (a, p) => setTurn(a, "error", p.at, p.error));
  on(turnInterrupted, (a, p) => {
    if (a.turn.status === "running" || isBlocked(a.turn.status)) setTurn(a, "ready", p.at, "中断しました");
  });
  on(subagentStarted, (a, p) => setSubagent(a, p.subagent, "running", p.at));
  on(subagentFinished, (a, p) => setSubagent(a, p.subagent, "done", p.at, p.message));
});
