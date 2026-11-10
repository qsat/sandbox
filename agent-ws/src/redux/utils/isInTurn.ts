import type { TurnStatus } from "../types/agent.ts";
import { isBlocked } from "./isBlocked.ts";

/** ターンの途中（実行中か、人の操作を待っている）。中断されうるのはこの間だけ */
export const isInTurn = (status: TurnStatus) => status === "running" || isBlocked(status);
