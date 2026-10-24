import type { Pid } from "../types/agent.ts";

/** pid から親を辿る（自分を含む。init の手前・limit 代まで） */
export function* ancestry(pid: Pid | null | undefined, parentOf: (pid: Pid) => Pid | undefined, limit = 32): Generator<Pid> {
  if (!pid || pid <= 1 || limit <= 0) return;
  yield pid;
  yield* ancestry(parentOf(pid), parentOf, limit - 1);
}
