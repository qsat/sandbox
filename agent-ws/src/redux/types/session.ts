/** エージェントのセッションとサブエージェント */

import type { Pid } from "./workspace.ts";

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

/** 本体として見せる状態。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export interface Attention {
  status: SessionStatus;
  reason?: string;
  since: number;
  subagent?: Subagent; // サブエージェント由来のとき
}
