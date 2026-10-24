/**
 * エージェントごとの出来事のログ（追記のみ）とスナップショット
 *   <agent>.jsonl      出来事を1行ずつ。並列に書く hook プロセスも追記するだけなのでロックは要らない
 *   <agent>.snap.json  ある位置までを流した結果。ただのキャッシュなので、同時に書かれても同じ内容になる
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  watch as fsWatch,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UnknownAction } from "@reduxjs/toolkit";
import type { Agent } from "../../types/agent.ts";

/** 既定の置き場所: $AGENT_WS_STATE_DIR、なければ $XDG_STATE_HOME/agent-ws/agents */
export const defaultDir = () =>
  process.env.AGENT_WS_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "agent-ws", "agents");

/** スナップショット: ある位置までを流した、エージェントと確認の状況 */
export interface Snapshot {
  agent: Agent;
  attention: { unseen: boolean };
}

export interface LogRead {
  snapshot?: Snapshot;
  events: UnknownAction[]; // スナップショットの後の出来事
  offset: number; // 読み終えた位置（バイト）
}

export function openLog(dir: string) {
  const safe = (s: string) => s.replace(/[^\w-]/g, "_");
  const logPath = (id: string) => join(dir, `${safe(id)}.jsonl`);
  const snapPath = (id: string) => join(dir, `${safe(id)}.snap.json`);

  return {
    /** ログのあるエージェント（最終更新時刻つき） */
    list(): { id: string; mtimeMs: number }[] {
      try {
        return readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .flatMap((f) => {
            try {
              return [{ id: f.slice(0, -".jsonl".length), mtimeMs: statSync(join(dir, f)).mtimeMs }];
            } catch {
              return []; // 読む間に消えた
            }
          });
      } catch {
        return [];
      }
    },

    /** from を省くとスナップショットから、指定するとその位置から読む。ログが無ければ null */
    read(id: string, from?: number): LogRead | null {
      let snapshot: Snapshot | undefined;
      let start = from ?? 0;
      if (from === undefined && existsSync(snapPath(id))) {
        try {
          const snap = JSON.parse(readFileSync(snapPath(id), "utf8")) as Snapshot & { offset: number };
          snapshot = { agent: snap.agent, attention: snap.attention };
          start = snap.offset;
        } catch {
          /* 壊れていれば最初から */
        }
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
        const events = buf
          .subarray(0, end)
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .flatMap((l) => {
            try {
              return [JSON.parse(l) as UnknownAction];
            } catch {
              return [];
            }
          });
        return { snapshot, events, offset: start + end };
      } finally {
        closeSync(fd);
      }
    },

    append(id: string, event: UnknownAction): void {
      mkdirSync(dir, { recursive: true });
      appendFileSync(logPath(id), `${JSON.stringify(event)}\n`);
    },

    saveSnapshot(id: string, snapshot: Snapshot, offset: number): void {
      const tmp = `${snapPath(id)}.${process.pid}.tmp`; // rename で置き換えて読み手に書きかけを見せない
      try {
        writeFileSync(tmp, JSON.stringify({ offset, ...snapshot }));
        renameSync(tmp, snapPath(id));
      } catch {
        /* キャッシュなので失敗してもよい */
      }
    },

    remove(id: string): void {
      for (const p of [logPath(id), snapPath(id)]) {
        try {
          unlinkSync(p);
        } catch {
          /* 既に無い */
        }
      }
    },

    /** ログのディレクトリの変更を見張る。戻り値で止める */
    watch(onChange: () => void): () => void {
      mkdirSync(dir, { recursive: true });
      const w = fsWatch(dir, () => onChange());
      return () => w.close();
    },
  };
}
