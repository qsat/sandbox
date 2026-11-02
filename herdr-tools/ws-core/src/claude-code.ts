import { shellQuote } from "@herdr-tools/utils/shell-quote";

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
