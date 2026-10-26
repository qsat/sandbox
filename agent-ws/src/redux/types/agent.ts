/** エージェント: worktree で動くエージェント1体と、そのターン・サブエージェント */

export type Pid = number;
export type AgentKind = "claude" | "codex";

/** ready: 入力待ち（起動直後・ターンの完了後） / waiting: 許可待ち / asking: 質問への回答待ち */
export type TurnStatus = "ready" | "running" | "waiting" | "asking" | "error";
export type SubagentStatus = "running" | "waiting" | "done";
export type Status = TurnStatus | SubagentStatus;

/** ターン（プロンプトから完了までの1往復）のいまの状況 */
export interface Turn {
  status: TurnStatus;
  reason?: string; // 許可内容・最終応答の1行目など
  since: number; // この状況になった時刻
}

/** エージェント1体。hook で分かった出来事の積み重ねで決まる */
export interface Agent {
  id: string;
  pid: Pid | null; // エージェント本体のプロセス
  cwd: string;
  transcript?: string; // 会話ログ。hook が発火しない中断を見つけるのに使う
  turn: Turn;
  subagents: Record<string, Subagent>;
}

/** サブエージェントは本体のプロセスの中で動くので、hook でだけ分かる */
export interface Subagent {
  id: string;
  type: string; // Explore, code-reviewer など
  status: SubagentStatus;
  detail?: string; // 実行中: 直近のツール / 許可待ち: 内容 / 完了: 最終応答の1行目
  since: number;
}

export interface SubagentRef {
  id: string;
  type: string;
}

/** OS から見えるエージェントのプロセス */
export interface AgentProcess {
  pid: Pid;
  kind: AgentKind;
  cwd: string;
}
