import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { attempt } from "../../../lib/attempt.ts";
import { lines, run } from "../../../lib/run.ts";
import type { Pid } from "../../types/agent.ts";

/** OS から見えるプロセス */
export interface ProcInfo {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
  cwd: string | null; // 読めなければ null
}

/** ps の一覧（cwd なし。親子関係を辿るだけならこれで足りる） */
export function psTable(): Omit<ProcInfo, "cwd">[] {
  return lines(run("ps", ["-axo", "pid=,ppid=,etime=,command="])).flatMap((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) return [];
    return [{ pid: Number(m[1]), ppid: Number(m[2]), elapsed: m[3], command: m[4] }];
  });
}

export function listProcesses(): ProcInfo[] {
  const cwds = readCwds();
  return psTable().map((p) => ({ ...p, cwd: cwds.get(p.pid) ?? null }));
}

/** pid → cwd（Linux: /proc、macOS など: lsof） */
function readCwds(): Map<Pid, string> {
  if (existsSync("/proc/self/cwd")) return procCwds();
  return lsofCwds();
}

const procCwds = () =>
  new Map(
    readdirSync("/proc")
      .filter((d) => /^\d+$/.test(d))
      // 権限が無い・終了済みのものは除く
      .flatMap((d) =>
        attempt<(readonly [Pid, string])[]>(() => [[Number(d), readlinkSync(`/proc/${d}/cwd`).replace(/ \(deleted\)$/, "")] as const], []),
      ),
  );

/** lsof -F の出力は p<pid>（その後に f<fd> などが続くことがある）と n<path> の繰り返し */
const lsofCwds = () =>
  new Map(
    [...(run("lsof", ["-a", "-d", "cwd", "-Fpn"]) ?? "").matchAll(/^p(\d+)\n(?:[^pn].*\n)*n(.*)$/gm)].map(
      (m) => [Number(m[1]), m[2]] as const,
    ),
  );

export function inspect(pid: Pid): { ppid: Pid; command: string } | null {
  const m = run("ps", ["-o", "ppid=,command=", "-p", String(pid)])
    ?.trim()
    .match(/^(\d+)\s+(.*)$/);
  if (!m) return null;
  return { ppid: Number(m[1]), command: m[2] };
}

export function isAlive(pid: Pid): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
