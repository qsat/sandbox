/**
 * セッション集約: エージェントのセッションとその配下のサブエージェント
 *
 * 状態はアクションの積み重ねで決まる（セッションごとのログに追記され、読むたびに流し直す）。
 * そのため reducer は純粋で、時刻もアクションの at だけを使う。状態が変わらないアクションは記録されない。
 * 本体が人を待っているか（attention）はサブエージェントから導けるので、保存せずに selector で求める。
 */
import { createAction, createReducer, isAnyOf, type PayloadActionCreator } from "@reduxjs/toolkit";
import type { HookInput } from "../../../types/hook.ts";
import type { AgentRef, Session, SessionStatus, SubagentStatus } from "../../../types/session.ts";
import type { Pid } from "../../../types/workspace.ts";

// ---------------------------------------------------------------------
// アクション（何が起きたか。すべて sessionId と発生時刻 at を持つ）
// ---------------------------------------------------------------------
type On<T = unknown> = { sessionId: string; at: number } & T;

/** プロセス・場所が分かった（新しいセッションならここで生まれる） */
export const attached = createAction<On<{ pid: Pid | null; cwd: string; transcript?: string }>>("session/attached");
export const started = createAction<On<{ source?: string }>>("session/started");
export const promptSubmitted = createAction<On>("session/promptSubmitted");
/** 許可を求めた。question は答えを求める質問（AskUserQuestion など） */
export const permissionRequested =
  createAction<On<{ agent?: AgentRef; summary: string; question: boolean }>>("session/permissionRequested");
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
  attached,
  started,
  promptSubmitted,
  permissionRequested,
  toolUsed,
  notified,
  stopped,
  failed,
  subagentStarted,
  subagentStopped,
  interrupted,
  seen,
  ended,
] as const;
export type SessionAction = ReturnType<(typeof sessionActions)[number]>;
/** ログに記録する対象のアクションか */
export const isSessionAction = isAnyOf(...sessionActions);

/** ログを流し直した（記録済みなので再び記録はしない）。base はスナップショット */
export const logReplayed = createAction<{ sessionId: string; base?: Session; actions: SessionAction[] }>("session/logReplayed");
/** 他のプロセスがログを消した */
export const forgotten = createAction<{ sessionId: string }>("session/forgotten");

// ---------------------------------------------------------------------
// 意図（〜してほしい）。listener が I/O して、結果を上のアクションで戻す
// ---------------------------------------------------------------------
/** ログからセッションを組み立てる（ids を省くと全セッション） */
export const sessionsRequested = createAction<{ ids?: string[] } | undefined>("session/sessionsRequested");
/** ログの変化を取り込む（他のプロセスが追記・削除した分だけ） */
export const logsChanged = createAction("session/logsChanged");
/** プロセスが消えたセッションを閉じ、hook の届かない中断を拾う */
export const settleRequested = createAction<{ at: number }>("session/settleRequested");
/** Claude Code の hook が呼ばれた */
export const hookReceived = createAction<{ input: HookInput; at: number }>("session/hookReceived");
/** そのペインで完了したセッションを既読にする（tmux の pane-focus-in とポップアップからの移動） */
export const seenInPaneRequested = createAction<{ panePid: Pid; at: number }>("session/seenInPaneRequested");
/** セッションを追い続ける（watch）。ログの変化はすぐ取り込み、interval ごとに消えたプロセス・中断を片付ける */
export const followStarted = createAction<{ intervalMs: number }>("session/followStarted");

// ---------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------
/** セッション ID → セッション */
export type SessionsState = Record<string, Session>;

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
  s.subagents[agent.id] ??= { id: agent.id, type: agent.type, status, since: at };
  const a = s.subagents[agent.id];
  if (a.status !== status) a.since = at;
  put(a, "status", status);
  if (detail !== undefined) put(a, "detail", detail);
}

export const sessionsReducer = createReducer({} as SessionsState, (b) => {
  /** 既知のセッションに対してだけ適用する（必ず attached が先に記録される） */
  const on = <P extends On>(action: PayloadActionCreator<P>, apply: (s: Session, p: P) => unknown) =>
    b.addCase(action, (st, { payload }) => {
      const s = st[payload.sessionId];
      if (s) apply(s, payload);
    });

  b.addCase(attached, (st, { payload: p }) => {
    const s = st[p.sessionId];
    if (!s) {
      st[p.sessionId] = {
        id: p.sessionId,
        pid: p.pid,
        cwd: p.cwd,
        transcript: p.transcript,
        status: "ready",
        since: p.at,
        unseen: false,
        subagents: {},
      };
      return;
    }
    if (p.pid) put(s, "pid", p.pid);
    if (p.transcript) put(s, "transcript", p.transcript);
  });
  b.addCase(ended, (st, { payload }) => void delete st[payload.sessionId]);
  b.addCase(forgotten, (st, { payload }) => void delete st[payload.sessionId]);
  b.addCase(logReplayed, (st, { payload }) => {
    if (payload.base) st[payload.base.id] = structuredClone(payload.base); // 凍結済みの状態が渡っても書き換えられるように
    for (const a of payload.actions) sessionsReducer(st, a); // draft のまま各アクションを適用する
  });

  // 圧縮（compact）後の SessionStart はターンの途中でも来るので状態を変えない
  on(started, (s, p) => {
    if (p.source === "compact") return;
    setStatus(s, "ready", p.at);
    put(s, "unseen", false);
  });
  on(promptSubmitted, (s, p) => {
    setStatus(s, "running", p.at);
    put(s, "unseen", false);
  });
  on(permissionRequested, (s, p) =>
    p.agent ? setSubagent(s, p.agent, "waiting", p.at, p.summary) : setStatus(s, p.question ? "asking" : "waiting", p.at, p.summary),
  );
  on(toolUsed, (s, p) => (p.agent ? setSubagent(s, p.agent, "running", p.at, p.tool) : setStatus(s, "running", p.at)));
  on(notified, (s, p) => setStatus(s, p.question ? "asking" : "waiting", p.at, p.message));
  on(stopped, (s, p) => {
    setStatus(s, "ready", p.at, p.message);
    put(s, "unseen", !p.background);
    // バックグラウンドが残っていなければ、サブエージェントはすべて終わっている
    if (p.background) return;
    for (const a of Object.values(s.subagents)) {
      if (a.status === "done") continue;
      a.status = "done";
      a.since = p.at;
    }
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

/** 人の操作を待っている状態 */
export const isBlocked = (st: SessionStatus | undefined) => st === "waiting" || st === "asking";
