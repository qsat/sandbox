import { isBlocked, type Session } from "../sessions/slice.ts";
import { attention } from "../sessions/selector.ts";

export type NoticeKind = "waiting" | "asking" | "error" | "ready";

/** 通知する遷移: 許可・質問待ち・エラーになった、またはターンが完了した（バックグラウンドが残る完了・中断は除く） */
export function noticeOf(prev: Session | undefined, next: Session | undefined): { kind: NoticeKind; reason?: string } | null {
  if (!next) return null;
  const a = prev && attention(prev);
  const b = attention(next);
  if (b.status !== a?.status && (isBlocked(b.status) || b.status === "error")) {
    return { kind: b.status as NoticeKind, reason: b.subagent ? `[${b.subagent.type}] ${b.subagent.detail ?? ""}` : b.reason };
  }
  return next.unseen && !prev?.unseen ? { kind: "ready", reason: next.reason } : null;
}
