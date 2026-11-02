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
