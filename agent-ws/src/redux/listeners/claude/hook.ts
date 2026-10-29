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
import type { SubagentRef } from "../../types/agent.ts";
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

/** 質問としてユーザーに答えを求めるツール（許可待ちと同じ PermissionRequest で届く） */
const QUESTION_TOOLS = new Set(["AskUserQuestion"]);
/** 質問として答えを求める通知（MCP の入力要求） */
const QUESTION_NOTIFICATIONS = new Set(["elicitation_dialog"]);

type InputKind = "permission" | "question";
const inputKind = (question: boolean): InputKind => {
  if (question) return "question";
  return "permission";
};

/** 出来事に変えるときに、どのイベントでも使うもの */
interface Context {
  on: { agentId: string; at: number };
  subagent?: SubagentRef; // サブエージェント内で発火したとき
  tool: string;
}

/** hook に登録するイベントの規則: matcher（無ければ全部）と、入力 → 出来事。登録するイベントと解釈するイベントはこの表で1つ */
interface Rule {
  matcher?: string;
  events: (e: HookInput, c: Context) => AgentEvent[];
}

const RULES: Record<string, Rule> = {
  SessionStart: { events: (e, { on }) => [agentStarted({ ...on, source: e.source })] },
  UserPromptSubmit: { events: (_, { on }) => [turnStarted(on)] },
  // 許可待ち・質問。どのエージェントの何のツールかが付く
  PermissionRequest: {
    matcher: "*",
    events: (e, { on, subagent, tool }) => [
      inputRequested({ ...on, subagent, kind: inputKind(QUESTION_TOOLS.has(tool)), summary: firstLine(describeTool(e)) ?? tool }),
    ],
  },
  // 許可後の再開・サブエージェントの直近ツール
  PostToolUse: { matcher: "*", events: (_, { on, subagent, tool }) => [toolUsed({ ...on, subagent, tool })] },
  PostToolUseFailure: { matcher: "*", events: (_, { on, subagent, tool }) => [toolUsed({ ...on, subagent, tool })] },
  // permission_prompt は数秒遅れて届き、agent_id もツールも無い。PermissionRequest で足りるので登録しない
  Notification: {
    matcher: "elicitation_dialog|agent_needs_input",
    events: (e, { on }) => {
      if (e.notification_type === "permission_prompt") return []; // matcher で外していても、届いたら無視する
      const kind = inputKind(QUESTION_NOTIFICATIONS.has(e.notification_type ?? ""));
      return [inputRequested({ ...on, kind, summary: firstLine(e.message) })];
    },
  },
  Stop: {
    events: (e, { on }) => [
      turnFinished({
        ...on,
        message: firstLine(e.last_assistant_message),
        background: Boolean(e.background_tasks?.some((t) => t.status === "running")),
      }),
    ],
  },
  StopFailure: { events: (e, { on }) => [turnFailed({ ...on, error: firstLine(e.error ?? e.message) })] },
  SubagentStart: {
    events: (_, { on, subagent }) => {
      if (!subagent) return [];
      return [subagentStarted({ ...on, subagent })];
    },
  },
  SubagentStop: {
    events: (e, { on, subagent }) => {
      if (!subagent) return [];
      return [subagentFinished({ ...on, subagent, message: firstLine(e.last_assistant_message) })];
    },
  },
  SessionEnd: { events: (_, { on }) => [agentEnded(on)] },
};

/** 入力候補の先読みなど内部用のエージェント（agent_type が空）。表示もしないし、本体の状況も変えない */
const isInternal = (e: HookInput) => Boolean(e.agent_id && !e.agent_type);

const subagentOf = (e: HookInput): SubagentRef | undefined => {
  if (!e.agent_id || !e.agent_type) return undefined;
  return { id: e.agent_id, type: e.agent_type };
};

/** hook の入力 → エージェントの出来事 */
export function toEvents(e: HookInput, at: number): AgentEvent[] {
  const rule = RULES[e.hook_event_name];
  if (!rule || !e.session_id || isInternal(e)) return [];
  return rule.events(e, { on: { agentId: e.session_id, at }, subagent: subagentOf(e), tool: e.tool_name ?? "tool" });
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
  const entries = Object.entries(RULES).map(([event, { matcher }]) => [event, [{ matcher, hooks: [hook] }]]);
  return { hooks: Object.fromEntries(entries) };
}
