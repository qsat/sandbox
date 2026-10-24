import type { Pid } from "../modules/app/workspace/slice.ts";

/** pid 自身から祖先へ順に辿る */
export function* ancestry(pid: Pid | null | undefined, parentOf: (pid: Pid) => Pid | undefined): Generator<Pid> {
  for (let i = 0; pid && pid > 1 && i < 32; pid = parentOf(pid), i++) yield pid;
}
