/** 人の対応が要るもの（許可・質問・エラー・完了の未確認）と、その知らせ */

import type { Subagent, TurnStatus } from "./agent.ts";

/** エージェントとして見せる状況。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export interface Attention {
  status: TurnStatus;
  reason?: string;
  since: number;
  subagent?: Subagent; // サブエージェント由来のとき
}

export type NoticeKind = "waiting" | "asking" | "error" | "ready";

/** 人の注意が要る遷移の知らせ */
export interface Notice {
  repo: string;
  branch?: string;
  kind: NoticeKind;
  reason?: string;
}

/** ステータスラインに出す印（対応が要るものの有無だけ） */
export interface StatusFlags {
  waiting: boolean;
  asking: boolean;
  unseen: boolean;
  error: boolean;
}
