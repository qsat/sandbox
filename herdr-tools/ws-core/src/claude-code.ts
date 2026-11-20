import { shellQuote } from "@herdr-tools/utils/shell-quote";
import type { ClaudeUsage, UsageWindow } from "./domain/usage";

export function claudeResumeCommand(claudeBin: string, sessionId: string) {
  return `${claudeBin} --resume ${shellQuote(sessionId)}`;
}

/** Claude Code のカスタムのテーマが受け付ける色の書き方。受け付けない色は Claude Code が黙って無視する */
const THEME_COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|ansi256\(\d{1,3}\)|ansi:[a-z]+)$/i;
export const THEME_COLOR_FORMATS = "#rrggbb・#rgb・rgb(r,g,b)・ansi256(n)・ansi:<名前>";

export function isClaudeThemeColor(color: string) {
  return THEME_COLOR.test(color);
}

/** dark を元に、プロンプトの枠の線（promptBorder）の色だけを変えたカスタムのテーマ */
export function promptColorTheme(name: string, color: string) {
  return { name, base: "dark", overrides: { promptBorder: color } };
}

export function claudeThemeArgs(theme: string) {
  return ["--settings", JSON.stringify({ theme: `custom:${theme}` })];
}

/**
 * ユーザーと対話している Claude Code のセッションか。Claude Code は hook と statusLine のコマンドに CLAUDE_CODE_ENTRYPOINT を渡し、
 * 対話のセッションは cli、`claude -p` などの対話でないセッションは sdk-cli などになる。変数が無ければ対話として扱う
 */
export function isInteractiveClaudeSession(env: Record<string, string | undefined>) {
  return !env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_ENTRYPOINT === "cli";
}

/** SessionStart hook と statusLine の入力（JSON）の session_id */
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

/** type がこの種類の行のうち、最後の行の field の文字を読む。途中で切れた行・壊れた行・空の値は飛ばして、その前の行を探す */
function lastTitleLine(text: string, type: string, field: string) {
  const mark = `"type":"${type}"`;
  for (let at = text.lastIndexOf(mark); at >= 0; at = at === 0 ? -1 : text.lastIndexOf(mark, at - 1)) {
    const start = text.lastIndexOf("\n", at) + 1;
    const end = text.indexOf("\n", at);
    try {
      const j = JSON.parse(text.slice(start, end < 0 ? undefined : end));
      if (j?.type === type && typeof j[field] === "string" && j[field].trim()) return j[field].trim() as string;
    } catch {
      // 切れた行・壊れた行。前の行を探す
    }
  }
  return undefined;
}

/**
 * 会話の記録（JSONL）から、セッションのタイトルを読む。記録の末尾だけを渡してもよい。
 * ユーザーが /rename で付けた名前（最後の custom-title の行の customTitle）があればそれを、
 * 無ければ Claude Code が自動で付けたタイトル（最後の ai-title の行の aiTitle）を返す。
 * /rename の後は、custom-title の行が依頼のたびに追記される（ai-title の行と同じ）
 */
export function sessionTitleFromTranscript(text: string) {
  return lastTitleLine(text, "custom-title", "customTitle") ?? lastTitleLine(text, "ai-title", "aiTitle");
}
