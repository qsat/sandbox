import type { BoardRow } from "./board";

type AgentRow = Extract<BoardRow, { kind: "agent" }>;

/** 人に知らせる status。blocked は人を待っている、done は見ていない間に終わった（見ると Herdr が idle に戻す） */
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

/** macOS の通知の題名と本文。題名にエージェントの名前と何が起きたか、本文に worktree のフォルダー名を書く */
export function attentionMessage(row: AgentRow) {
  const what = row.rawStatus === "blocked" ? "待っています" : "終わりました";
  return { title: `${row.label} が${what}`, body: row.worktree.split("/").filter(Boolean).at(-1) ?? row.worktree };
}

/** osascript の引数。題名と本文は argv で渡し、AppleScript の文字列に埋め込まない（引用符を含んでも壊れない） */
export function osascriptArgs(message: { title: string; body: string }) {
  return ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", message.title, message.body];
}
