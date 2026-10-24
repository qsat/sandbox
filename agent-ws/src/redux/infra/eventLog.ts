/**
 * セッションごとのアクションのログ（追記のみ）とスナップショット
 *   <session>.jsonl      アクションを1行ずつ。並列に書く hook プロセスも追記するだけなのでロックは要らない
 *   <session>.snap.json  ある位置までを流した結果。ただのキャッシュなので、同時に書かれても同じ内容になる
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, watch as fsWatch, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session, SessionAction } from "../modules/app/sessions/slice.ts";

export const DIR =
  process.env.AGENT_WS_STATE_DIR ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "agent-ws", "sessions");

const safe = (s: string) => s.replace(/[^\w-]/g, "_");
const logPath = (id: string) => join(DIR, `${safe(id)}.jsonl`);
const snapPath = (id: string) => join(DIR, `${safe(id)}.snap.json`);

export interface LogRead {
  base?: Session; // スナップショット
  actions: SessionAction[]; // その後のアクション
  offset: number; // 読み終えた位置（バイト）
}

/** ログのあるセッション（最終更新時刻つき） */
export function list(): { id: string; mtimeMs: number }[] {
  try {
    return readdirSync(DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .flatMap((f) => {
        try {
          return [{ id: f.slice(0, -".jsonl".length), mtimeMs: statSync(join(DIR, f)).mtimeMs }];
        } catch {
          return []; // 読む間に消えた
        }
      });
  } catch {
    return [];
  }
}

/** from を省くとスナップショットから、指定するとその位置から読む。ログが無ければ null */
export function read(id: string, from?: number): LogRead | null {
  let base: Session | undefined;
  let start = from ?? 0;
  if (from === undefined && existsSync(snapPath(id))) {
    try {
      const snap = JSON.parse(readFileSync(snapPath(id), "utf8")) as { offset: number; state: Session };
      base = snap.state;
      start = snap.offset;
    } catch { /* 壊れていれば最初から */ }
  }
  let fd: number;
  try {
    fd = openSync(logPath(id), "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, size - start));
    readSync(fd, buf, 0, buf.length, start);
    // 書きかけの最終行は次回に回す
    const end = buf.lastIndexOf(0x0a) + 1;
    const actions = buf.subarray(0, end).toString("utf8").split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as SessionAction];
      } catch {
        return [];
      }
    });
    return { base, actions, offset: start + end };
  } finally {
    closeSync(fd);
  }
}

export function append(id: string, action: SessionAction): void {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(logPath(id), `${JSON.stringify(action)}\n`);
}

export function saveSnapshot(id: string, state: Session, offset: number): void {
  const tmp = `${snapPath(id)}.${process.pid}.tmp`; // rename で置き換えて読み手に書きかけを見せない
  try {
    writeFileSync(tmp, JSON.stringify({ offset, state }));
    renameSync(tmp, snapPath(id));
  } catch { /* キャッシュなので失敗してもよい */ }
}

export function remove(id: string): void {
  for (const p of [logPath(id), snapPath(id)]) {
    try {
      unlinkSync(p);
    } catch { /* 既に無い */ }
  }
}

/** ログのディレクトリの変更を見張る。戻り値で止める */
export function watch(onChange: () => void): () => void {
  mkdirSync(DIR, { recursive: true });
  const w = fsWatch(DIR, () => onChange());
  return () => w.close();
}
