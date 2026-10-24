import type { RootState } from "../../../createStore.ts";
import type { Attention, Session } from "../../../types/session.ts";
import { isBlocked } from "./slice.ts";

export const selectSessions = (st: RootState): Session[] => Object.values(st.app.sessions);
export const selectSession = (st: RootState, id: string): Session | undefined => st.app.sessions[id];

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
