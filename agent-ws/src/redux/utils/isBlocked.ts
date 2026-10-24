import type { TurnStatus } from "../types/agent.ts";

/** 人の操作を待っている状況 */
export const isBlocked = (status: TurnStatus | undefined) => status === "waiting" || status === "asking";
