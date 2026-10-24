import type { RootState } from "../../../createStore.ts";
import { attention, selectSessions } from "../../app/sessions/selector.ts";

/** ステータスラインに出す印（対応が要るものの有無だけ） */
export interface StatusFlags {
  waiting: boolean;
  asking: boolean;
  unseen: boolean;
  error: boolean;
}

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
