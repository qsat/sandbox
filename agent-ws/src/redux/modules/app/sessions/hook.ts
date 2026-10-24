/**
 * Claude Code との境界（腐敗防止層）: hook の入力・会話ログの形を知っているのはここだけ
 * 入力の形は本物の Claude Code（2.1.309）で確かめた。src/fixtures/ に実データがある
 */
import type { SessionAction } from "./slice.ts";
import {
  failed, notified, permissionRequested, promptSubmitted, started, stopped, subagentStarted, subagentStopped, toolUsed, ended,
} from "./slice.ts";
import { firstLine } from "../../../utils/firstLine.ts";
import type { HookInput } from "../../../types/hook.ts";

/** hook に登録するイベントと matcher。toActions が解釈するイベントと一致させる */
export const HOOK_EVENTS: Record<string, string | null> = {
  SessionStart: null,
  UserPromptSubmit: null,
  PermissionRequest: "*", // 許可待ち・質問。どのエージェントの何のツールかが付く
  PostToolUse: "*", // 許可後の再開・サブエージェントの直近ツール
  PostToolUseFailure: "*",
  Notification: "elicitation_dialog|agent_needs_input", // permission_prompt は PermissionRequest で足りる
  Stop: null,
  StopFailure: null,
  SubagentStart: null,
  SubagentStop: null,
  SessionEnd: null,
};

/** 質問としてユーザーに答えを求めるツール（許可待ちと同じ PermissionRequest で届く） */
const QUESTION_TOOLS = new Set(["AskUserQuestion"]);

/** hook の入力 → ドメインのアクション */
export function toActions(e: HookInput, at: number): SessionAction[] {
  const sessionId = e.session_id;
  // 内部用のエージェントは表示もしないし、本体の状態も変えない
  if (!sessionId || (e.agent_id && !e.agent_type)) return [];
  const on = { sessionId, at };
  const agent = e.agent_id && e.agent_type ? { id: e.agent_id, type: e.agent_type } : undefined;
  const tool = e.tool_name ?? "tool";

  switch (e.hook_event_name) {
    case "SessionStart":
      return [started({ ...on, source: e.source })];
    case "UserPromptSubmit":
      return [promptSubmitted(on)];
    case "PermissionRequest":
      return [permissionRequested({ ...on, agent, summary: firstLine(describeTool(e)) ?? tool, question: QUESTION_TOOLS.has(tool) })];
    case "PostToolUse":
    case "PostToolUseFailure":
      return [toolUsed({ ...on, agent, tool })];
    case "Notification":
      // permission_prompt は数秒遅れて届き、agent_id もツールも無い。PermissionRequest で記録済み
      if (e.notification_type === "permission_prompt") return [];
      return [notified({ ...on, question: e.notification_type === "elicitation_dialog", message: firstLine(e.message) })];
    case "Stop":
      return [stopped({ ...on, message: firstLine(e.last_assistant_message), background: Boolean(e.background_tasks?.some((t) => t.status === "running")) })];
    case "StopFailure":
      return [failed({ ...on, error: firstLine(e.error ?? e.message) })];
    case "SubagentStart":
      return agent ? [subagentStarted({ ...on, agent })] : [];
    case "SubagentStop":
      return agent ? [subagentStopped({ ...on, agent, message: firstLine(e.last_assistant_message) })] : [];
    case "SessionEnd":
      return [ended(on)];
    default:
      return [];
  }
}

/** 許可を求めているツールの1行要約（Bash: echo hi など） */
function describeTool(e: HookInput): string {
  const i = e.tool_input ?? {};
  const arg = [i.command, i.file_path, i.url, i.pattern, i.description].find((v) => typeof v === "string");
  return [e.tool_name ?? "tool", arg].filter(Boolean).join(": ");
}

/**
 * Esc での中断と許可の拒否では hook が何も発火しない。どちらも会話ログに user の "[Request interrupted by user…]" が書かれる。
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
    return Date.parse(entry.timestamp ?? "") >= since && Array.isArray(content) &&
      content.some((c) => c?.type === "text" && String(c.text).startsWith("[Request interrupted by user"));
  }
  return false;
}

/** ~/.claude/settings.json の hooks に足す設定（全イベント同じコマンド。何が起きたかは入力 JSON で判断） */
export function hooksConfig(runtime: string, script: string) {
  const hook = { type: "command", command: runtime, args: [script, "hook"], timeout: 10 };
  const entries = Object.entries(HOOK_EVENTS).map(([event, matcher]) => [event, [{ ...(matcher ? { matcher } : {}), hooks: [hook] }]]);
  return { hooks: Object.fromEntries(entries) };
}
