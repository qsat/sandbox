import { existsSync, readdirSync, readlinkSync } from "node:fs";
import type { Pid, ProcInfo } from "../modules/app/workspace/slice.ts";
import { lines, run } from "./shell.ts";

/** ps の一覧（cwd なし。親子関係を辿るだけならこれで足りる） */
export function psTable(): Omit<ProcInfo, "cwd">[] {
  return lines(run("ps", ["-axo", "pid=,ppid=,etime=,command="])).flatMap((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), elapsed: m[3], command: m[4] }] : [];
  });
}

export function listProcesses(): ProcInfo[] {
  const cwds = readCwds();
  return psTable().map((p) => ({ ...p, cwd: cwds.get(p.pid) ?? null }));
}

/** pid → cwd（Linux: /proc、macOS など: lsof） */
function readCwds(): Map<Pid, string> {
  const cwds = new Map<Pid, string>();
  if (existsSync("/proc/self/cwd")) {
    for (const d of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        cwds.set(Number(d), readlinkSync(`/proc/${d}/cwd`).replace(/ \(deleted\)$/, ""));
      } catch { /* 権限なし・終了済み */ }
    }
    return cwds;
  }
  let pid = 0; // lsof -F の出力は p<pid> と n<path> の繰り返し
  for (const l of lines(run("lsof", ["-a", "-d", "cwd", "-Fpn"]))) {
    if (l[0] === "p") pid = Number(l.slice(1));
    else if (l[0] === "n" && pid) cwds.set(pid, l.slice(1));
  }
  return cwds;
}

export function inspect(pid: Pid): { ppid: Pid; command: string } | null {
  const m = run("ps", ["-o", "ppid=,command=", "-p", String(pid)])?.trim().match(/^(\d+)\s+(.*)$/);
  return m ? { ppid: Number(m[1]), command: m[2] } : null;
}

export function isAlive(pid: Pid): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
