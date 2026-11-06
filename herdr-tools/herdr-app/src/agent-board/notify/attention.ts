// 通知するかの判断。エージェントの status の変化だけを見る。I/O なし
import type { BoardRow } from "../board";

export type AgentRow = Extract<BoardRow, { kind: "agent" }>;

/** ユーザーに知らせる status。blocked はユーザーを待っている、done は見ていない間に終わった（見ると Herdr が idle に戻す） */
const ATTENTION_STATUSES = new Set(["blocked", "done"]);

/**
 * 前回見た status と比べ、blocked か done に変わったエージェントを返す。
 * prev が null（mod を読み込んで最初の 1 回）は、今の status を覚えるだけで何も返さない。読み込み直しのたびに通知が出ないようにするため。
 */
export function attentionChanges(prev: Map<string, string> | null, rows: BoardRow[]) {
  const agents = rows.filter((r): r is AgentRow => r.kind === "agent");
  const next = new Map(agents.map((a) => [a.key, a.rawStatus]));
  const changed = prev === null ? [] : agents.filter((a) => ATTENTION_STATUSES.has(a.rawStatus) && prev.get(a.key) !== a.rawStatus);
  return { changed, next };
}
