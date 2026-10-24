/** 人の注意が要る遷移の通知 */

export type NoticeKind = "waiting" | "asking" | "error" | "ready";

/** 人の注意が要る遷移の通知内容 */
export interface Notice {
  repo: string;
  branch?: string;
  kind: NoticeKind;
  reason?: string;
}
