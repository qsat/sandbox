/**
 * エージェント集約: エージェント1体の、いまのターンとサブエージェント
 *
 * 状態は出来事の積み重ねで決まる（エージェントごとのログに追記され、読むたびに流し直す）。
 * そのため reducer は純粋で、時刻も出来事の at だけを使う。状態が変わらない出来事は記録されない。
 * OS から見えるエージェントのプロセス（processes）は観測した「いまの値」で、ログには残さない。
 */
import { createSlice, isAnyOf, type PayloadAction } from "@reduxjs/toolkit";
import type { Agent, AgentProcess, Pid, SubagentRef, SubagentStatus, TurnStatus } from "../../../types/agent.ts";
import { isBlocked } from "./selector.ts";

type On<T = unknown> = { agentId: string; at: number } & T;

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

/** 既知のエージェントに対してだけ適用する case reducer（必ず agentAttached が先に記録される） */
const toAgent =
  <P extends On>(apply: (a: Agent, p: P) => unknown) =>
  (st: AgentsState, { payload }: PayloadAction<P>) => {
    const a = st.byId[payload.agentId];
    if (a) apply(a, payload);
  };

/**
 * 出来事の type は "agent/…"（ログに記録されるので変えない）。
 * restored・forgotten・processesScanned は記録されない（スナップショット・他のプロセスの削除・観測した値）
 */
export const agents = createSlice({
  name: "agent",
  initialState: { byId: {}, processes: [] } as AgentsState,
  reducers: {
    /** エージェントのプロセス・場所が分かった（新しいエージェントならここで生まれる） */
    attached: (st, { payload: p }: PayloadAction<On<{ pid: Pid | null; cwd: string; transcript?: string }>>) => {
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
    },
    /** source: startup / resume / clear / compact。圧縮（compact）後はターンの途中でも来るので状況を変えない */
    started: toAgent<On<{ source?: string }>>((a, p) => p.source !== "compact" && setTurn(a, "ready", p.at)),
    turnStarted: toAgent<On>((a, p) => setTurn(a, "running", p.at)),
    /** 人の入力を求めた（permission: 許可 / question: 質問への回答）。subagent からのこともある */
    inputRequested: toAgent<On<{ subagent?: SubagentRef; kind: "permission" | "question"; summary?: string }>>((a, p) => {
      if (p.subagent) setSubagent(a, p.subagent, "waiting", p.at, p.summary);
      else setTurn(a, p.kind === "question" ? "asking" : "waiting", p.at, p.summary);
    }),
    toolUsed: toAgent<On<{ subagent?: SubagentRef; tool: string }>>((a, p) => {
      if (p.subagent) setSubagent(a, p.subagent, "running", p.at, p.tool);
      else setTurn(a, "running", p.at);
    }),
    /** ターンが終わった。background: バックグラウンドのサブエージェントが残っている（終われば自動で再開する） */
    turnFinished: toAgent<On<{ message?: string; background: boolean }>>((a, p) => {
      setTurn(a, "ready", p.at, p.message);
      // バックグラウンドが残っていなければ、サブエージェントはすべて終わっている
      if (p.background) return;
      for (const s of Object.values(a.subagents)) {
        if (s.status === "done") continue;
        s.status = "done";
        s.since = p.at;
      }
    }),
    turnFailed: toAgent<On<{ error?: string }>>((a, p) => setTurn(a, "error", p.at, p.error)),
    /** Esc での中断・許可の拒否 */
    turnInterrupted: toAgent<On>((a, p) => {
      if (a.turn.status === "running" || isBlocked(a.turn.status)) setTurn(a, "ready", p.at, "中断しました");
    }),
    subagentStarted: toAgent<On<{ subagent: SubagentRef }>>((a, p) => setSubagent(a, p.subagent, "running", p.at)),
    subagentFinished: toAgent<On<{ subagent: SubagentRef; message?: string }>>((a, p) =>
      setSubagent(a, p.subagent, "done", p.at, p.message),
    ),
    ended: (st, { payload }: PayloadAction<On>) => {
      delete st.byId[payload.agentId];
    },
    /** スナップショットから戻した（attention はその時点の確認状況） */
    restored: (st, { payload }: PayloadAction<{ agent: Agent; attention: { unseen: boolean } }>) => {
      st.byId[payload.agent.id] = structuredClone(payload.agent); // 凍結済みの状態が渡っても書き換えられるように
    },
    /** 他のプロセスがログを消した */
    forgotten: (st, { payload }: PayloadAction<{ agentId: string }>) => {
      delete st.byId[payload.agentId];
    },
    processesScanned: (st, { payload }: PayloadAction<AgentProcess[]>) => {
      st.processes = payload;
    },
  },
});

export const {
  attached: agentAttached,
  started: agentStarted,
  turnStarted,
  inputRequested,
  toolUsed,
  turnFinished,
  turnFailed,
  turnInterrupted,
  subagentStarted,
  subagentFinished,
  ended: agentEnded,
  restored: agentRestored,
  forgotten: agentForgotten,
  processesScanned: agentProcessesScanned,
} = agents.actions;

/** 記録される出来事 */
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
