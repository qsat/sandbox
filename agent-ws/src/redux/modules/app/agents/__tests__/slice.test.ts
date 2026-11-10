import { expect, test } from "bun:test";
import type { RootState } from "../../../../rootReducer.ts";
import { rootReducer } from "../../../../rootReducer.ts";
import type { AgentEvent } from "../slice.ts";
import { agentAttached, agentRestored, inputRequested, toolUsed, turnFinished, turnInterrupted, turnStarted } from "../slice.ts";

const on = (at: number) => ({ agentId: "a", at });
const run = (...events: AgentEvent[]): RootState => events.reduce(rootReducer, rootReducer(undefined, { type: "init" }));
const born = agentAttached({ ...on(0), pid: 1, cwd: "/w" });

test("状況が変わらない出来事は同じ参照を返す（ログに残さない判定に使う）", () => {
  const running = run(born, turnStarted(on(1)));
  const again = rootReducer(running, toolUsed({ ...on(2), tool: "Bash" }));
  expect(again.app.agents.byId.a).toBe(running.app.agents.byId.a);
  expect(again.app.attention.a).toBe(running.app.attention.a);
});

test("許可待ちはツールの実行で running に戻り、質問は質問待ちになる", () => {
  const waiting = run(born, turnStarted(on(1)), inputRequested({ ...on(2), kind: "permission", summary: "Edit: /w/a.ts" }));
  expect(waiting.app.agents.byId.a?.turn).toMatchObject({ status: "waiting", reason: "Edit: /w/a.ts", since: 2 });
  expect(rootReducer(waiting, toolUsed({ ...on(3), tool: "Edit" })).app.agents.byId.a?.turn.status).toBe("running");
  expect(run(born, inputRequested({ ...on(1), kind: "question", summary: "AskUserQuestion" })).app.agents.byId.a?.turn.status).toBe(
    "asking",
  );
});

test("中断は実行中・待ちのときだけ入力待ちに戻す", () => {
  expect(run(born, turnStarted(on(1)), turnInterrupted(on(2))).app.agents.byId.a?.turn).toMatchObject({
    status: "ready",
    reason: "中断しました",
  });
  const done = run(born, turnStarted(on(1)), turnFinished({ ...on(2), message: "終わり", background: false }));
  expect(rootReducer(done, turnInterrupted(on(3))).app.agents.byId.a).toBe(done.app.agents.byId.a);
});

test("スナップショットから戻し、その続きの出来事を適用する", () => {
  const snap = run(born, turnStarted(on(1)));
  const agent = snap.app.agents.byId.a;
  if (!agent) throw new Error("エージェントがいない");
  const restored = [agentRestored({ agent, attention: { unseen: false } }), turnFinished({ ...on(2), background: false })].reduce(
    rootReducer,
    rootReducer(undefined, { type: "init" }),
  );
  expect(restored.app.agents.byId.a?.turn).toMatchObject({ status: "ready", since: 2 });
  expect(restored.app.attention.a).toEqual({ unseen: true });
});
