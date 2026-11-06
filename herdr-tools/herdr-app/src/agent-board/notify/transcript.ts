// Claude Code の会話の記録（~/.claude/projects/<cwd>/<セッション ID>.jsonl）の場所と、末尾の読み取り。I/O なし
// 記録の場所の規則と JSONL の形は Claude Code の事情で、変わると通知の副題と本文が空になる（エージェントの名前で埋まる）

/** 会話の記録から読む、最後の依頼と返答 */
export interface TranscriptTail {
  lastPrompt: string | null;
  lastReply: string | null;
}

export const EMPTY_TAIL: TranscriptTail = { lastPrompt: null, lastReply: null };

/** Claude Code の会話の記録のパス。フォルダー名は cwd の英数字以外を - に置き換えたもの */
export function transcriptPath(home: string, cwd: string, sessionId: string) {
  return `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
}

/**
 * 会話の記録（JSONL）の末尾から、最後の依頼（last-prompt の行）と最後の返答（assistant の text）を読む。
 * 末尾だけを渡すので、1 行目が途中で切れていたり、壊れた行があったりしても飛ばす
 */
export function parseTranscriptTail(text: string): TranscriptTail {
  let lastPrompt: string | null = null;
  let lastReply: string | null = null;
  for (const line of text.split("\n")) {
    let j: { type?: string; lastPrompt?: unknown; message?: { content?: unknown } };
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type === "last-prompt" && typeof j.lastPrompt === "string") lastPrompt = j.lastPrompt;
    if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      const texts = (j.message.content as { type?: string; text?: unknown }[]).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
      if (texts.length > 0) lastReply = texts.join("\n");
    }
  }
  return { lastPrompt, lastReply };
}
