/**
 * 状態ファイル
 *   <session>.json              セッション
 *   <session>.sub.<agent>.json  サブエージェント（並列に書かれるので1体1ファイル）
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionRecord, Subagent } from "../domain.ts";

const DIR =
  process.env.AGENT_WS_STATE_DIR ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "agent-ws", "sessions");

const safe = (s: string) => s.replace(/[^\w-]/g, "_");
const sessionPath = (id: string) => join(DIR, `${safe(id)}.json`);
const subagentPath = (sessionId: string, id: string) => join(DIR, `${safe(sessionId)}.sub.${safe(id)}.json`);

function read<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function write(path: string, data: unknown): void {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`; // rename で置き換えて読み手に書きかけを見せない
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch { /* 既に無い */ }
}

function files(): string[] {
  try {
    return readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

export const getSession = (id: string) => read<SessionRecord>(sessionPath(id));
export const putSession = (s: SessionRecord) => write(sessionPath(s.id), s);
export const listSessions = () => files().filter((f) => !f.includes(".sub.")).flatMap((f) => read<SessionRecord>(join(DIR, f)) ?? []);

export const getSubagent = (sessionId: string, id: string) => read<Subagent>(subagentPath(sessionId, id));
export const putSubagent = (a: Subagent) => write(subagentPath(a.sessionId, a.id), a);
export const removeSubagent = (a: Subagent) => remove(subagentPath(a.sessionId, a.id));
export const listSubagents = () => files().filter((f) => f.includes(".sub.")).flatMap((f) => read<Subagent>(join(DIR, f)) ?? []);

/** セッションとそのサブエージェントをまとめて消す */
export function removeSession(id: string): void {
  remove(sessionPath(id));
  for (const f of files().filter((f) => f.startsWith(`${safe(id)}.sub.`))) remove(join(DIR, f));
}
