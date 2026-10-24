/**
 * セッション集約: エージェントのセッションとその配下のサブエージェント
 *
 * 状態はアクションの積み重ねで決まる（セッションごとのログに追記され、読むたびに流し直す）。
 * そのため reducer は純粋で、時刻もアクションの at だけを使う。状態が変わらないアクションは記録されない。
 * 本体が人を待っているか（attention）はサブエージェントから導けるので、保存せずに selector で求める。
 */
import { createAction, createEntityAdapter, createReducer, isAnyOf, type EntityState, type PayloadActionCreator } from "@reduxjs/toolkit";
import type { Pid } from "./model.ts";

/** ready: 入力待ち（起動直後・ターン完了） / waiting: 許可待ち / asking: 質問への回答待ち */
export type SessionStatus = "ready" | "running" | "waiting" | "asking" | "error";
export type SubagentStatus = "running" | "waiting" | "done";
export type Status = SessionStatus | SubagentStatus;

export interface Session {
  id: string;
  pid: Pid | null; // エージェント本体
  cwd: string;
  transcript?: string; // 会話ログ。hook が発火しない中断を見つけるのに使う
  status: SessionStatus;
  reason?: string; // 許可内容・最終応答の1行目など
  since: number; // この状態になった時刻
  unseen: boolean; // ターンが完了して、まだ見ていない
  subagents: Record<string, Subagent>;
}

/** サブエージェントは本体プロセス内で動くので hook でのみ観測できる */
export interface Subagent {
  id: string;
  type: string; // Explore, code-reviewer など
  status: SubagentStatus;
  detail?: string; // 実行中: 直近のツール / 許可待ち: 内容 / 完了: 最終応答の1行目
  since: number;
}

export interface AgentRef {
  id: string;
  type: string;
}

// ---------------------------------------------------------------------
// アクション（何が起きたか。すべて sessionId と発生時刻 at を持つ）
// ---------------------------------------------------------------------
type On<T = {}> = { sessionId: string; at: number } & T;

/** プロセス・場所が分かった（新しいセッションならここで生まれる） */
export const attached = createAction<On<{ pid: Pid | null; cwd: string; transcript?: string }>>("session/attached");
export const started = createAction<On<{ source?: string }>>("session/started");
export const promptSubmitted = createAction<On>("session/promptSubmitted");
/** 許可を求めた。question は答えを求める質問（AskUserQuestion など） */
export const permissionRequested = createAction<On<{ agent?: AgentRef; summary: string; question: boolean }>>("session/permissionRequested");
export const toolUsed = createAction<On<{ agent?: AgentRef; tool: string }>>("session/toolUsed");
/** 許可以外で人の入力を求めた（MCP の elicitation など） */
export const notified = createAction<On<{ question: boolean; message?: string }>>("session/notified");
/** ターンが終わった。background: バックグラウンドのサブエージェントが残っている（終われば本体が自動で再開する） */
export const stopped = createAction<On<{ message?: string; background: boolean }>>("session/stopped");
export const failed = createAction<On<{ error?: string }>>("session/failed");
export const subagentStarted = createAction<On<{ agent: AgentRef }>>("session/subagentStarted");
export const subagentStopped = createAction<On<{ agent: AgentRef; message?: string }>>("session/subagentStopped");
/** Esc での中断・許可の拒否（hook は発火せず、会話ログでだけ分かる） */
export const interrupted = createAction<On>("session/interrupted");
/** 完了したターンの結果を見た（ペインへのフォーカス・ポップアップからの移動など） */
export const seen = createAction<On>("session/seen");
export const ended = createAction<On>("session/ended");

const sessionActions = [
  attached, started, promptSubmitted, permissionRequested, toolUsed, notified, stopped, failed,
  subagentStarted, subagentStopped, interrupted, seen, ended,
] as const;
export type SessionAction = ReturnType<(typeof sessionActions)[number]>;
/** ログに記録する対象のアクションか */
export const isSessionAction = isAnyOf(...sessionActions);

/** ログを流し直した（記録済みなので再び記録はしない）。base はスナップショット */
export const logReplayed = createAction<{ sessionId: string; base?: Session; actions: SessionAction[] }>("session/logReplayed");
/** 他のプロセスがログを消した */
export const forgotten = createAction<{ sessionId: string }>("session/forgotten");

// ---------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------
const adapter = createEntityAdapter<Session>();
export type SessionsState = EntityState<Session, string>;

/** 値が変わるときだけ書く（同じ値の代入も「変更」にしないため。変わらないアクションはログに残さない） */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K]): void {
  if (o[k] === v) return;
  if (v === undefined) delete o[k];
  else o[k] = v;
}

function setStatus(s: Session, status: SessionStatus, at: number, reason?: string): void {
  if (s.status !== status) s.since = at;
  put(s, "status", status);
  put(s, "reason", reason);
}

function setSubagent(s: Session, agent: AgentRef, status: SubagentStatus, at: number, detail?: string): void {
  const a = (s.subagents[agent.id] ??= { id: agent.id, type: agent.type, status, since: at });
  if (a.status !== status) a.since = at;
  put(a, "status", status);
  if (detail !== undefined) put(a, "detail", detail);
}

export const sessionsReducer = createReducer(adapter.getInitialState() as SessionsState, (b) => {
  /** 既知のセッションに対してだけ適用する（必ず attached が先に記録される） */
  const on = <P extends On>(action: PayloadActionCreator<P>, apply: (s: Session, p: P) => unknown) =>
    b.addCase(action, (st, { payload }) => {
      const s = st.entities[payload.sessionId];
      if (s) apply(s, payload);
    });

  b.addCase(attached, (st, { payload: p }) => {
    const s = st.entities[p.sessionId];
    if (!s) {
      adapter.addOne(st, { id: p.sessionId, pid: p.pid, cwd: p.cwd, transcript: p.transcript, status: "ready", since: p.at, unseen: false, subagents: {} });
      return;
    }
    if (p.pid) put(s, "pid", p.pid);
    if (p.transcript) put(s, "transcript", p.transcript);
  });
  b.addCase(ended, (st, { payload }) => adapter.removeOne(st, payload.sessionId));
  b.addCase(forgotten, (st, { payload }) => adapter.removeOne(st, payload.sessionId));
  b.addCase(logReplayed, (st, { payload }) => {
    if (payload.base) adapter.setOne(st, structuredClone(payload.base)); // 凍結済みの状態が渡っても書き換えられるように
    for (const a of payload.actions) sessionsReducer(st, a); // draft のまま各アクションを適用する
  });

  // 圧縮（compact）後の SessionStart はターンの途中でも来るので状態を変えない
  on(started, (s, p) => p.source !== "compact" && (setStatus(s, "ready", p.at), put(s, "unseen", false)));
  on(promptSubmitted, (s, p) => (setStatus(s, "running", p.at), put(s, "unseen", false)));
  on(permissionRequested, (s, p) =>
    p.agent ? setSubagent(s, p.agent, "waiting", p.at, p.summary) : setStatus(s, p.question ? "asking" : "waiting", p.at, p.summary));
  on(toolUsed, (s, p) => (p.agent ? setSubagent(s, p.agent, "running", p.at, p.tool) : setStatus(s, "running", p.at)));
  on(notified, (s, p) => setStatus(s, p.question ? "asking" : "waiting", p.at, p.message));
  on(stopped, (s, p) => {
    setStatus(s, "ready", p.at, p.message);
    put(s, "unseen", !p.background);
    // バックグラウンドが残っていなければ、サブエージェントはすべて終わっている
    if (!p.background) for (const a of Object.values(s.subagents)) if (a.status !== "done") (a.status = "done"), (a.since = p.at);
  });
  on(failed, (s, p) => setStatus(s, "error", p.at, p.error));
  on(subagentStarted, (s, p) => setSubagent(s, p.agent, "running", p.at));
  on(subagentStopped, (s, p) => setSubagent(s, p.agent, "done", p.at, p.message));
  on(interrupted, (s, p) => {
    if (s.status !== "running" && !isBlocked(s.status)) return;
    setStatus(s, "ready", p.at, "中断しました");
    put(s, "unseen", false);
  });
  on(seen, (s) => put(s, "unseen", false));
});

// ---------------------------------------------------------------------
// selector
// ---------------------------------------------------------------------
export const sessionSelectors = adapter.getSelectors();

/** 人の操作を待っている状態 */
export const isBlocked = (st: SessionStatus | undefined) => st === "waiting" || st === "asking";

/** 本体として見せる状態。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export interface Attention {
  status: SessionStatus;
  reason?: string;
  since: number;
  subagent?: Subagent; // サブエージェント由来のとき
}

export function attention(s: Session): Attention {
  if (isBlocked(s.status) || s.status === "error") return s;
  const sub = Object.values(s.subagents).find((a) => a.status === "waiting");
  return sub ? { status: "waiting", since: sub.since, subagent: sub } : s;
}

/** 表示するサブエージェント（完了したものは2分だけ残す） */
export const visibleSubagents = (s: Session, now: number) =>
  Object.values(s.subagents)
    .filter((a) => a.status !== "done" || now - a.since < 2 * 60_000)
    .sort((a, b) => a.since - b.since);

/** 通知する遷移: 許可・質問待ち・エラーになった、またはターンが完了した（バックグラウンドが残る完了・中断は除く） */
export type NoticeKind = "waiting" | "asking" | "error" | "ready";
export function noticeOf(prev: Session | undefined, next: Session | undefined): { kind: NoticeKind; reason?: string } | null {
  if (!next) return null;
  const a = prev && attention(prev);
  const b = attention(next);
  if (b.status !== a?.status && (isBlocked(b.status) || b.status === "error")) {
    return { kind: b.status as NoticeKind, reason: b.subagent ? `[${b.subagent.type}] ${b.subagent.detail ?? ""}` : b.reason };
  }
  return next.unseen && !prev?.unseen ? { kind: "ready", reason: next.reason } : null;
}

/** ステータスラインに出す印（対応が要るものの有無だけ） */
export interface StatusFlags {
  waiting: boolean;
  asking: boolean;
  unseen: boolean;
  error: boolean;
}

export function statusFlags(sessions: Session[]): StatusFlags {
  const st = sessions.map((s) => attention(s).status);
  return {
    waiting: st.includes("waiting"),
    asking: st.includes("asking"),
    unseen: sessions.some((s) => s.unseen),
    error: st.includes("error"),
  };
}
