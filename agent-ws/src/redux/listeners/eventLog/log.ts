/**
 * エージェントごとの出来事のログ（追記のみ）とスナップショット
 *   <agent>.jsonl      出来事を1行ずつ。並列に書く hook プロセスも追記するだけなのでロックは要らない
 *   <agent>.snap.json  ある位置までを流した結果。ただのキャッシュなので、同時に書かれても同じ内容になる
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
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
import { join } from "node:path";
import type { UnknownAction } from "@reduxjs/toolkit";
import { attempt } from "../../../lib/attempt.ts";
import type { Agent } from "../../types/agent.ts";

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

/** 読みはじめる位置: 指定が無ければスナップショットの位置（無いか壊れていれば最初）から */
type Start = { snapshot?: Snapshot; start: number };

export function openLog(dir: string) {
  const safe = (s: string) => s.replace(/[^\w-]/g, "_");
  const logPath = (id: string) => join(dir, `${safe(id)}.jsonl`);
  const snapPath = (id: string) => join(dir, `${safe(id)}.snap.json`);

  const fromSnapshot = (id: string): Start => {
    const snap = attempt(() => JSON.parse(readFileSync(snapPath(id), "utf8")) as Snapshot & { offset: number }, null);
    if (!snap) return { start: 0 };
    return { snapshot: { agent: snap.agent, attention: snap.attention }, start: snap.offset };
  };
  const startOf = (id: string, from?: number): Start => {
    if (from === undefined) return fromSnapshot(id);
    return { start: from };
  };

  /** start から読める出来事と、読み終えた位置（書きかけの最終行は次回に回す） */
  const readFrom = (fd: number, start: number) => {
    const buf = Buffer.alloc(Math.max(0, fstatSync(fd).size - start));
    readSync(fd, buf, 0, buf.length, start);
    const end = buf.lastIndexOf(0x0a) + 1;
    const events = buf
      .subarray(0, end)
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => attempt(() => [JSON.parse(l) as UnknownAction], []));
    return { events, offset: start + end };
  };

  return {
    /** ログのあるエージェント（最終更新時刻つき） */
    list(): { id: string; mtimeMs: number }[] {
      return attempt(() => readdirSync(dir), [])
        .filter((f) => f.endsWith(".jsonl"))
        .flatMap((f) => attempt(() => [{ id: f.slice(0, -".jsonl".length), mtimeMs: statSync(join(dir, f)).mtimeMs }], [])); // 読む間に消えたものは除く
    },

    /** from を省くとスナップショットから、指定するとその位置から読む。ログが無ければ null */
    read(id: string, from?: number): LogRead | null {
      const fd = attempt(() => openSync(logPath(id), "r"), null);
      if (fd === null) return null;
      const { snapshot, start } = startOf(id, from);
      try {
        return { snapshot, ...readFrom(fd, start) };
      } finally {
        closeSync(fd);
      }
    },

    append(id: string, event: UnknownAction): void {
      mkdirSync(dir, { recursive: true });
      appendFileSync(logPath(id), `${JSON.stringify(event)}\n`);
    },

    saveSnapshot(id: string, snapshot: Snapshot, offset: number): void {
      const tmp = `${snapPath(id)}.${randomUUID()}.tmp`; // rename で置き換えて読み手に書きかけを見せない
      // キャッシュなので失敗してもよい
      attempt(() => {
        writeFileSync(tmp, JSON.stringify({ offset, ...snapshot }));
        renameSync(tmp, snapPath(id));
      }, undefined);
    },

    remove(id: string): void {
      for (const p of [logPath(id), snapPath(id)]) attempt(() => unlinkSync(p), undefined); // 既に無ければそれでよい
    },

    /** ログのディレクトリの変更を見張る。戻り値で止める */
    watch(onChange: () => void): () => void {
      mkdirSync(dir, { recursive: true });
      const w = fsWatch(dir, () => onChange());
      return () => w.close();
    },
  };
}
