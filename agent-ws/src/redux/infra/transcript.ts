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
