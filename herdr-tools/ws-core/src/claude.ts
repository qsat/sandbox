// エージェントプログラム（Claude Code）についての知識。

import { shellQuote } from "@herdr-tools/utils/shell-quote";

/** 会話を再開するコマンド */
export function resumeCommand(bin: string, sessionId: string): string {
  return `${bin} --resume ${shellQuote(sessionId)}`;
}

/**
 * SessionStart hook の stdin（session_id, transcript_path, cwd, hook_event_name, source）から会話IDを取る。
 * hook は起動だけでなく再開・/clear・compact でも呼ばれるので、記録は常に最新の会話を指す。
 */
export function parseSessionStart(stdin: string): string | undefined {
  try {
    const id = JSON.parse(stdin)?.session_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}
