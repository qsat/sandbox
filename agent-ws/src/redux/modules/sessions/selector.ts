import type { RootState } from "../../createStore.ts";
import type { Session, SessionStatus, Subagent } from "./slice.ts";
import { isBlocked } from "./slice.ts";

export const selectSessions = (st: RootState): Session[] => Object.values(st.sessions);
export const selectSession = (st: RootState, id: string): Session | undefined => st.sessions[id];

/** 本体として見せる状態。本体が待っていなくても、サブエージェントが許可を待っていれば許可待ち */
export interface Attention {
  status: SessionStatus;
  reason?: string;
  since: number;
  subagent?: Subagent; // サブエージェント由来のとき
}

export function attention(s: Session): Attention {
  if (isBlocked(s.status) || s.status === "error") return s;
  const sub = Object.values(s.subagents).find((a) => a.status === "waiting");
  return sub ? { status: "waiting", since: sub.since, subagent: sub } : s;
}

/** 表示するサブエージェント（完了したものは2分だけ残す） */
export const visibleSubagents = (s: Session, now: number) =>
  Object.values(s.subagents)
    .filter((a) => a.status !== "done" || now - a.since < 2 * 60_000)
    .sort((a, b) => a.since - b.since);
