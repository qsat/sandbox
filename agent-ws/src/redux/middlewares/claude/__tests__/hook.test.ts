import { expect, test } from "bun:test";
import { scan } from "../../../../lib/scan.ts";
import { type RootState, rootReducer } from "../../../createStore.ts";
import { agentAttached } from "../../../modules/app/agents/slice.ts";
import { attentionOf, selectNotice, selectUnseen } from "../../../modules/app/attention/selector.ts";
import { type HookInput, toEvents } from "../hook.ts";
import { interruptedSince } from "../transcript.ts";

/** 本物の Claude Code（2.1.309）で取った hook 入力を順に流し、各イベント後の状況を記録する */
async function replay(file: string) {
  const text = await Bun.file(new URL(file, import.meta.url)).text();
  const inputs = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as HookInput);
  const initial = rootReducer(undefined, agentAttached({ agentId: "s1", at: 0, pid: 1, cwd: "/w/proj" }));
  // 各イベントの後の状態: 前の状態に、そのイベントから出た出来事をすべて流したもの
  const states = scan(inputs, (st: RootState, e, t) => toEvents(e, t + 1).reduce((s, a) => rootReducer(s, a), st), initial);
  return inputs.map((e, t) => {
    const prev = states[t - 1] ?? initial;
    const st = states[t];
    const agent = st.app.agents.byId.s1;
    const at = agent && attentionOf(agent);
    const subs = Object.values(agent?.subagents ?? {})
      .map((s) => `${s.type}:${s.status}`)
      .join(",");
    return {
      event: e.hook_event_name,
      status: at?.status,
      reason: at?.reason,
      subs,
      unseen: selectUnseen(st, "s1"),
      notice: selectNotice(prev, st, "s1")?.kind,
      changed: prev.app !== st.app,
    };
  });
}

test("実データ: バックグラウンドのサブエージェントが許可を求め、許可されて完了する", async () => {
  const steps = await replay("./fixtures/claude-code-2.1.309.jsonl");
  const at = (event: string, nth = 0) => {
    const s = steps.filter((x) => x.event === event)[nth];
    if (!s) throw new Error(`${event} の ${nth} 番目が無い`);
    return s;
  };

  // 本体のターンはサブエージェントを残して終わる（自動で再開するので知らせない）
  expect(at("Stop")).toMatchObject({ status: "ready", unseen: false, notice: undefined });
  // サブエージェントの許可待ちで本体も許可待ちに見え、知らせる。詳細はサブエージェントの側
  expect(at("PermissionRequest")).toMatchObject({
    status: "waiting",
    reason: undefined,
    subs: "general-purpose:waiting",
    notice: "waiting",
  });
  // 後から来る Notification（agent_id も詳細も無い）は何も変えない
  expect(at("Notification")).toMatchObject({ status: "waiting", changed: false });
  // 許可されたら本体は元の入力待ちに見える。知らせない
  expect(at("PostToolUse", 1)).toMatchObject({ status: "ready", subs: "general-purpose:running", notice: undefined });
  // サブエージェントの結果で本体が自動で再開し、完了で知らせる
  expect(at("Stop", 1)).toMatchObject({ status: "ready", unseen: true, notice: "ready" });
  expect(at("SubagentStop", 1)).toMatchObject({ subs: "general-purpose:done" });
  // agent_type が空の内部用エージェント（0 番目と 2 番目）は何も変えない
  expect([at("SubagentStop", 0).changed, at("SubagentStop", 2).changed]).toEqual([false, false]);
  expect(steps.at(-1)).toMatchObject({ event: "SessionEnd", status: undefined });
});

test("interruptedSince: 会話ログの末尾がこの状況になった後の中断（Esc・許可の拒否）か", () => {
  const entry = (type: string, text: string, ms: number) =>
    JSON.stringify({ type, timestamp: new Date(ms).toISOString(), message: { content: [{ type: "text", text }] } });
  const denied = [
    entry("assistant", "消します", 1_500),
    entry("user", "[Request interrupted by user for tool use]", 2_000),
    '{"type":"last-prompt"}',
  ];
  expect(interruptedSince(denied, 1_000)).toBe(true);
  expect(interruptedSince([entry("assistant", "消します", 1_500)], 1_000)).toBe(false);
  expect(interruptedSince(denied, 2_500)).toBe(false); // 前のターンの中断
});
