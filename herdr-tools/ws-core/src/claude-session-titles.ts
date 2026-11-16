import { open } from "node:fs/promises";
import { aiTitleFromTranscript, claudeTranscriptPath } from "./claude-code";
import type { SessionTitles } from "./ports";

/** まず読む末尾の大きさ。ai-title の行は依頼のたびに追記されるので、たいていはここに入っている */
const TAIL_BYTES = 64 * 1024;
/** 末尾に無かったときに読む大きさ。道具の出力が長く続いた依頼の途中でも、前のタイトルを出し続けるため */
const WIDE_BYTES = 32 * 1024 * 1024;

async function readTail(path: string, bytes: number) {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    await f.read(buf, 0, length, size - length);
    return { text: buf.toString("utf8"), whole: length === size };
  } finally {
    await f.close();
  }
}

/** Claude Code の会話の記録（~/.claude/projects/<cwd>/<セッション ID>.jsonl）から、セッションのタイトルを読む */
export class ClaudeSessionTitles implements SessionTitles {
  constructor(private readonly home: string) {}

  /** 記録が無い・読めない・タイトルがまだ付いていないときは undefined */
  async titleOf(cwd: string, claudeSessionId: string) {
    try {
      const path = claudeTranscriptPath(this.home, cwd, claudeSessionId);
      const tail = await readTail(path, TAIL_BYTES);
      const title = aiTitleFromTranscript(tail.text);
      if (title || tail.whole) return title;
      return aiTitleFromTranscript((await readTail(path, WIDE_BYTES)).text);
    } catch {
      return undefined;
    }
  }
}
