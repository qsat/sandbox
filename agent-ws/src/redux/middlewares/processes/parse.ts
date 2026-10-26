/**
 * ps・lsof の出力の解析（純粋な関数）
 */
import type { Pid } from "../../types/agent.ts";

/** ps に見えるプロセス（cwd なし） */
export interface PsEntry {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
}

/** `ps -axo pid=,ppid=,etime=,command=` の出力 */
export const parsePsTable = (out: string): PsEntry[] =>
  out
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .flatMap((m) => {
      if (!m) return [];
      return [{ pid: Number(m[1]), ppid: Number(m[2]), elapsed: m[3], command: m[4] }];
    });

/** `lsof -a -d cwd -Fpn` の出力: p<pid>（その後に f<fd> などが続くことがある）と n<path> の繰り返し → pid → cwd */
export const parseLsofCwds = (out: string): Map<Pid, string> =>
  new Map([...out.matchAll(/^p(\d+)\n(?:[^pn].*\n)*n(.*)$/gm)].map((m) => [Number(m[1]), m[2]] as const));
