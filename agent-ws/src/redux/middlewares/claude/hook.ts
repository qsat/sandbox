/**
 * Claude Code の hook: 入力の形と、それをエージェントの出来事に変えるルール
 * 入力の形は本物の Claude Code（2.1.309）で確かめた。__tests__/fixtures/ に実データがある
 */
import type { AgentEvent } from "../../modules/app/agents/slice.ts";
import {
  agentEnded,
  agentStarted,
  inputRequested,
  subagentFinished,
  subagentStarted,
  toolUsed,
  turnFailed,
  turnFinished,
  turnStarted,
} from "../../modules/app/agents/slice.ts";
import { firstLine } from "../../utils/firstLine.ts";

/** hook の入力（使うフィールドだけ） */
export interface HookInput {
  hook_event_name: string;
  session_id: string; // エージェントの ID として使う
  cwd?: string;
  transcript_path?: string;
  source?: string; // SessionStart: startup / resume / clear / compact
  agent_id?: string; // サブエージェント内で発火したとき
  agent_type?: string; // 内部用のエージェント（入力候補の先読みなど）では空か無い
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
  background_tasks?: { status: string }[]; // Stop 時点のバックグラウンドのサブエージェントなど
  error?: string;
}

/** hook に登録するイベントと matcher。toEvents が解釈するイベントと一致させる */
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

/** hook の入力 → エージェントの出来事 */
export function toEvents(e: HookInput, at: number): AgentEvent[] {
  const agentId = e.session_id;
  // 内部用のエージェントは表示もしないし、本体の状況も変えない
  if (!agentId || (e.agent_id && !e.agent_type)) return [];
  const on = { agentId, at };
  const subagent = e.agent_id && e.agent_type ? { id: e.agent_id, type: e.agent_type } : undefined;
  const tool = e.tool_name ?? "tool";

  switch (e.hook_event_name) {
    case "SessionStart":
      return [agentStarted({ ...on, source: e.source })];
    case "UserPromptSubmit":
      return [turnStarted(on)];
    case "PermissionRequest":
      return [
        inputRequested({
          ...on,
          subagent,
          kind: QUESTION_TOOLS.has(tool) ? "question" : "permission",
          summary: firstLine(describeTool(e)) ?? tool,
        }),
      ];
    case "PostToolUse":
    case "PostToolUseFailure":
      return [toolUsed({ ...on, subagent, tool })];
    case "Notification":
      // permission_prompt は数秒遅れて届き、agent_id もツールも無い。PermissionRequest で記録済み
      if (e.notification_type === "permission_prompt") return [];
      return [
        inputRequested({
          ...on,
          kind: e.notification_type === "elicitation_dialog" ? "question" : "permission",
          summary: firstLine(e.message),
        }),
      ];
    case "Stop":
      return [
        turnFinished({
          ...on,
          message: firstLine(e.last_assistant_message),
          background: Boolean(e.background_tasks?.some((t) => t.status === "running")),
        }),
      ];
    case "StopFailure":
      return [turnFailed({ ...on, error: firstLine(e.error ?? e.message) })];
    case "SubagentStart":
      return subagent ? [subagentStarted({ ...on, subagent })] : [];
    case "SubagentStop":
      return subagent ? [subagentFinished({ ...on, subagent, message: firstLine(e.last_assistant_message) })] : [];
    case "SessionEnd":
      return [agentEnded(on)];
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

/** ~/.claude/settings.json の hooks に足す設定（全イベント同じコマンド。何が起きたかは入力 JSON で判断） */
export function hooksConfig(runtime: string, script: string) {
  const hook = { type: "command", command: runtime, args: [script, "hook"], timeout: 10 };
  const entries = Object.entries(HOOK_EVENTS).map(([event, matcher]) => [event, [{ ...(matcher ? { matcher } : {}), hooks: [hook] }]]);
  return { hooks: Object.fromEntries(entries) };
}
