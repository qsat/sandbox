/**
 * 通知の文面: 「リポジトリ [ブランチ]」と「⏳ 許可待ち: 理由」
 */
import type { Status } from "../redux/types/agent.ts";
import type { Notice, NoticeKind } from "../redux/types/attention.ts";
import { STATUS, shortName } from "./parts.ts";

/** 知らせの種類 → 見せる状況（完了の知らせは「完了」） */
const NOTICE_STATUS: Record<NoticeKind, Status> = { waiting: "waiting", asking: "asking", error: "error", ready: "done" };

export function notification({ repo, branch, kind, reason }: Notice): { title: string; body: string } {
  const s = STATUS[NOTICE_STATUS[kind]];
  return {
    title: [shortName(repo), branch && `[${branch}]`].filter(Boolean).join(" "),
    body: [`${s.icon} ${s.label}`, reason].filter(Boolean).join(": "),
  };
}
