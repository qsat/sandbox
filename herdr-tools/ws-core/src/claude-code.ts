import { shellQuote } from "@herdr-tools/utils/shell-quote";
import type { ClaudeUsage, UsageWindow } from "./domain/usage";

export function claudeResumeCommand(claudeBin: string, sessionId: string) {
  return `${claudeBin} --resume ${shellQuote(sessionId)}`;
}

export function sessionIdFromSessionStartHook(stdin: string) {
  try {
    const id = JSON.parse(stdin)?.session_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

function windowFromStatusLine(raw: unknown): UsageWindow | undefined {
  const w = raw as { used_percentage?: unknown; resets_at?: unknown } | undefined;
  return typeof w?.used_percentage === "number" && typeof w.resets_at === "number" ? { usedPercentage: w.used_percentage, resetsAtEpochSec: w.resets_at } : undefined;
}

export function usageFromStatusLine(stdin: string): ClaudeUsage | undefined {
  let limits: { five_hour?: unknown; seven_day?: unknown } | undefined;
  try {
    limits = JSON.parse(stdin)?.rate_limits;
  } catch {
    return undefined;
  }
  const fiveHour = windowFromStatusLine(limits?.five_hour);
  const sevenDay = windowFromStatusLine(limits?.seven_day);
  if (!fiveHour && !sevenDay) return undefined;
  return { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) };
}

export function contextUsedPercentageFromStatusLine(stdin: string) {
  try {
    const used = JSON.parse(stdin)?.context_window?.used_percentage;
    return typeof used === "number" ? Math.min(100, Math.max(0, Math.round(used))) : undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code の会話の記録（JSONL）のパス。フォルダー名は cwd の英数字以外を - に置き換えたもの */
export function claudeTranscriptPath(home: string, cwd: string, sessionId: string) {
  return `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
}

const AI_TITLE_MARK = '"type":"ai-title"';

/**
 * 会話の記録（JSONL）から、Claude Code が自動で付けた最新のタイトル（最後の ai-title の行の aiTitle）を読む。
 * 記録の末尾だけを渡してもよい。途中で切れた行・壊れた行は飛ばして、その前の ai-title の行を探す
 */
export function aiTitleFromTranscript(text: string) {
  for (let at = text.lastIndexOf(AI_TITLE_MARK); at >= 0; at = at === 0 ? -1 : text.lastIndexOf(AI_TITLE_MARK, at - 1)) {
    const start = text.lastIndexOf("\n", at) + 1;
    const end = text.indexOf("\n", at);
    try {
      const j = JSON.parse(text.slice(start, end < 0 ? undefined : end));
      if (j?.type === "ai-title" && typeof j.aiTitle === "string" && j.aiTitle.trim()) return j.aiTitle.trim() as string;
    } catch {
      // 切れた行・壊れた行。前の ai-title の行を探す
    }
  }
  return undefined;
}
