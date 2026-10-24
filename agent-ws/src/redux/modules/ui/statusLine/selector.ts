import type { RootState } from "../../../createStore.ts";
import { attention, selectSessions } from "../../app/sessions/selector.ts";
import type { StatusFlags } from "../../../types/statusLine.ts";

export function selectStatusFlags(st: RootState): StatusFlags {
  const sessions = selectSessions(st);
  const statuses = sessions.map((s) => attention(s).status);
  return {
    waiting: statuses.includes("waiting"),
    asking: statuses.includes("asking"),
    unseen: sessions.some((s) => s.unseen),
    error: statuses.includes("error"),
  };
}
