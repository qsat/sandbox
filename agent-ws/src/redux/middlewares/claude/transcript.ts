/**
 * Claude Code の会話ログ。Esc での中断と許可の拒否では hook が何も発火しないので、ここでだけ分かる
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { attempt } from "../../../lib/attempt.ts";

/** 会話ログが since より後に書かれていれば、末尾の行を返す（そうでなければ読まない） */
export function tailSince(path: string, since: number, bytes = 16_384): string[] | null {
  const stat = attempt(() => statSync(path), null);
  if (!stat || stat.mtimeMs <= since) return null;
  return attempt(() => readTail(path, Math.min(bytes, stat.size), stat.size), null);
}

/** 末尾の length バイトを行に分ける */
function readTail(path: string, length: number, size: number): string[] {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8").split("\n").filter(Boolean);
  } finally {
    closeSync(fd);
  }
}

interface Entry {
  type?: string;
  timestamp?: string;
  message?: { content?: unknown };
}

/** 1行を読む（末尾を途中から読んだ1行目など、読めなければ undefined） */
const parse = (line: string): Entry | undefined => attempt(() => JSON.parse(line), undefined);

const isInterruption = (content: unknown) =>
  Array.isArray(content) && content.some((c) => c?.type === "text" && String(c.text).startsWith("[Request interrupted by user"));

/**
 * 中断も拒否も、会話ログに user の "[Request interrupted by user…]" が書かれる。
 * 末尾の発言がそれで、かつ since 以降の記録なら中断された（前のターンの中断は拾わない）
 */
export function interruptedSince(transcriptTail: string[], since: number): boolean {
  const last = transcriptTail.map(parse).findLast((e) => e?.type === "user" || e?.type === "assistant");
  if (!last) return false;
  return Date.parse(last.timestamp ?? "") >= since && isInterruption(last.message?.content);
}
