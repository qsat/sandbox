import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { attempt } from "../../../lib/attempt.ts";
import { run } from "../../../lib/run.ts";
import type { Pid } from "../../types/agent.ts";
import { type PsEntry, parseLsofCwds, parsePsTable } from "./parse.ts";

/** OS から見えるプロセス */
export interface ProcInfo extends PsEntry {
  cwd: string | null; // 読めなければ null
}

/** ps の一覧（cwd なし。親子関係を辿るだけならこれで足りる） */
export const psTable = (): PsEntry[] => parsePsTable(run("ps", ["-axo", "pid=,ppid=,etime=,command="]) ?? "");

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

const lsofCwds = () => parseLsofCwds(run("lsof", ["-a", "-d", "cwd", "-Fpn"]) ?? "");

/** ps の一覧から、プロセスの親と実行したコマンドを引く（祖先を辿るのに使う） */
export function processTree() {
  const byPid = new Map(psTable().map((p) => [p.pid, p]));
  return {
    parentOf: (pid: Pid) => byPid.get(pid)?.ppid,
    commandOf: (pid: Pid) => byPid.get(pid)?.command ?? "",
  };
}

export function isAlive(pid: Pid): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
