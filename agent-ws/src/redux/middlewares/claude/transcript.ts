/**
 * Claude Code の会話ログ。Esc での中断と許可の拒否では hook が何も発火しないので、ここでだけ分かる
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";

/** 会話ログが since より後に書かれていれば、末尾の行を返す（そうでなければ読まない） */
export function tailSince(path: string, since: number, bytes = 16_384): string[] | null {
  try {
    const { mtimeMs, size } = statSync(path);
    if (mtimeMs <= since) return null;
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(Math.min(bytes, size));
      readSync(fd, buf, 0, buf.length, size - buf.length);
      return buf.toString("utf8").split("\n").filter(Boolean);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * 中断も拒否も、会話ログに user の "[Request interrupted by user…]" が書かれる。
 * 末尾の発言がそれで、かつ since 以降の記録なら中断された（前のターンの中断は拾わない）
 */
export function interruptedSince(transcriptTail: string[], since: number): boolean {
  for (const line of transcriptTail.toReversed()) {
    let entry: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // 末尾を途中から読んだ1行目など
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const content = entry.message?.content;
    return (
      Date.parse(entry.timestamp ?? "") >= since &&
      Array.isArray(content) &&
      content.some((c) => c?.type === "text" && String(c.text).startsWith("[Request interrupted by user"))
    );
  }
  return false;
}
