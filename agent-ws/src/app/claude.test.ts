import { expect, test } from "bun:test";
import type { SessionsState } from "../domain/sessions.ts";
import { attached, attention, noticeOf, sessionsReducer } from "../domain/sessions.ts";
import type { HookInput } from "./claude.ts";
import { interruptedSince, toActions } from "./claude.ts";

/** 本物の Claude Code（2.1.309）で取った hook 入力を順に流し、各イベント後の状態を記録する */
async function replay(file: string) {
  const text = await Bun.file(new URL(file, import.meta.url)).text();
  let st: SessionsState = sessionsReducer(undefined, attached({ sessionId: "s1", at: 0, pid: 1, cwd: "/w/proj" }));
  return text.trim().split("\n").map((line, t) => {
    const e = JSON.parse(line) as HookInput;
    const prev = st.s1;
    for (const a of toActions(e, t + 1)) st = sessionsReducer(st, a);
    const s = st.s1;
    const at = s && attention(s);
    const subs = Object.values(s?.subagents ?? {}).map((a) => `${a.type}:${a.status}`).join(",");
    return { event: e.hook_event_name, status: at?.status, reason: at?.reason, subs, unseen: s?.unseen, notice: noticeOf(prev, s)?.kind, changed: prev !== s };
  });
}

test("実データ: バックグラウンドのサブエージェントが許可を求め、許可されて完了する", async () => {
  const steps = await replay("../fixtures/claude-code-2.1.309.jsonl");
  const at = (event: string, nth = 0) => steps.filter((s) => s.event === event)[nth];

  // 本体のターンはサブエージェントを残して終わる（自動で再開するので通知しない）
  expect(at("Stop")).toMatchObject({ status: "ready", unseen: false, notice: undefined });
  // サブエージェントの許可待ちで本体も許可待ちに見え、通知する。詳細はサブエージェントの側
  expect(at("PermissionRequest")).toMatchObject({ status: "waiting", reason: undefined, subs: "general-purpose:waiting", notice: "waiting" });
  // 後から来る Notification（agent_id も詳細も無い）は何も変えない
  expect(at("Notification")).toMatchObject({ status: "waiting", changed: false });
  // 許可されたら本体は元の入力待ちに見える。通知はしない
  expect(at("PostToolUse", 1)).toMatchObject({ status: "ready", subs: "general-purpose:running", notice: undefined });
  // サブエージェントの結果で本体が自動で再開し、完了で通知する
  expect(at("Stop", 1)).toMatchObject({ status: "ready", unseen: true, notice: "ready" });
  expect(at("SubagentStop", 1)).toMatchObject({ subs: "general-purpose:done" });
  // agent_type が空の内部用エージェント（0 番目と 2 番目）は何も変えない
  expect([at("SubagentStop", 0).changed, at("SubagentStop", 2).changed]).toEqual([false, false]);
  expect(steps.at(-1)).toMatchObject({ event: "SessionEnd", status: undefined });
});

test("interruptedSince: 会話ログの末尾がこの状態になった後の中断（Esc・許可の拒否）か", () => {
  const entry = (type: string, text: string, ms: number) =>
    JSON.stringify({ type, timestamp: new Date(ms).toISOString(), message: { content: [{ type: "text", text }] } });
  const denied = [entry("assistant", "消します", 1_500), entry("user", "[Request interrupted by user for tool use]", 2_000), '{"type":"last-prompt"}'];
  expect(interruptedSince(denied, 1_000)).toBe(true);
  expect(interruptedSince([entry("assistant", "消します", 1_500)], 1_000)).toBe(false);
  expect(interruptedSince(denied, 2_500)).toBe(false); // 前のターンの中断
});
