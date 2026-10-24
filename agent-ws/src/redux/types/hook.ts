/** Claude Code の hook の入力（使うフィールドだけ）。形は本物の Claude Code（2.1.309）で確かめた */

/** hook の入力（使うフィールドだけ） */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
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
