import type { RootState } from "../../../createStore.ts";
import type { Agent } from "../../../types/agent.ts";
import type { Attention, NoticeKind, StatusFlags } from "../../../types/attention.ts";
import { isBlocked, selectAgent, selectAgents } from "../agents/selector.ts";

/** ターンの完了を、人がまだ見ていないか */
export const selectUnseen = (st: RootState, agentId: string): boolean => st.app.attention[agentId]?.unseen ?? false;

/** エージェントとして見せる状況。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export function attentionOf(a: Agent): Attention {
  if (isBlocked(a.turn.status) || a.turn.status === "error") return a.turn;
  const sub = Object.values(a.subagents).find((s) => s.status === "waiting");
  return sub ? { status: "waiting", since: sub.since, subagent: sub } : a.turn;
}

/** ステータスラインの印 */
export function selectStatusFlags(st: RootState): StatusFlags {
  const agents = selectAgents(st);
  const statuses = agents.map((a) => attentionOf(a).status);
  return {
    waiting: statuses.includes("waiting"),
    asking: statuses.includes("asking"),
    unseen: agents.some((a) => selectUnseen(st, a.id)),
    error: statuses.includes("error"),
  };
}

/** 知らせる遷移: 許可・質問待ち・エラーになった、またはターンが完了した（未確認になった） */
export function selectNotice(prev: RootState, next: RootState, agentId: string): { kind: NoticeKind; reason?: string } | null {
  const before = selectAgent(prev, agentId);
  const after = selectAgent(next, agentId);
  if (!after) return null;
  const a = before && attentionOf(before);
  const b = attentionOf(after);
  if (b.status !== a?.status && (isBlocked(b.status) || b.status === "error")) {
    return { kind: b.status as NoticeKind, reason: b.subagent ? `[${b.subagent.type}] ${b.subagent.detail ?? ""}` : b.reason };
  }
  return selectUnseen(next, agentId) && !selectUnseen(prev, agentId) ? { kind: "ready", reason: after.turn.reason } : null;
}
