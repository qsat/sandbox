import type { RootState } from "../../../rootReducer.ts";
import type { Agent, TurnStatus } from "../../../types/agent.ts";
import type { Attention, NoticeKind, StatusFlags } from "../../../types/attention.ts";
import { isBlocked } from "../../../utils/isBlocked.ts";
import { selectAgent, selectAgents } from "../agents/selector.ts";

/** ターンの完了を、人がまだ見ていないか */
export const selectUnseen = (st: RootState, agentId: string): boolean => st.app.attention[agentId]?.unseen ?? false;

/** エージェントとして見せる状況。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export function attentionOf(a: Agent): Attention {
  if (isBlocked(a.turn.status) || a.turn.status === "error") return a.turn;
  const sub = Object.values(a.subagents).find((s) => s.status === "waiting");
  if (!sub) return a.turn;
  return { status: "waiting", since: sub.since, subagent: sub };
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

/** 人に知らせる状況: 許可・質問待ち・エラー */
const isAlert = (s: TurnStatus): s is "waiting" | "asking" | "error" => isBlocked(s) || s === "error";

/** 知らせる遷移: 許可・質問待ち・エラーになった、またはターンが完了した（未確認になった） */
export function selectNotice(prev: RootState, next: RootState, agentId: string): { kind: NoticeKind; reason?: string } | null {
  const before = selectAgent(prev, agentId);
  const after = selectAgent(next, agentId);
  if (!after) return null;
  const a = before && attentionOf(before);
  const b = attentionOf(after);
  if (b.status !== a?.status && isAlert(b.status)) return { kind: b.status, reason: reasonOf(b) };
  if (!selectUnseen(next, agentId) || selectUnseen(prev, agentId)) return null;
  return { kind: "ready", reason: after.turn.reason };
}

/** 知らせる理由: サブエージェント由来なら、どのサブエージェントの何か */
function reasonOf(x: Attention): string | undefined {
  if (!x.subagent) return x.reason;
  return `[${x.subagent.type}] ${x.subagent.detail ?? ""}`;
}
