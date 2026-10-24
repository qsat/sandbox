import { expect, test } from "bun:test";
import { type RootState, rootReducer } from "../../../../createStore.ts";
import type { AgentEvent } from "../../agents/slice.ts";
import { agentAttached, inputRequested, toolUsed, turnFinished, turnInterrupted, turnStarted } from "../../agents/slice.ts";
import { attentionOf, selectNotice, selectStatusFlags, selectUnseen } from "../selector.ts";
import { acknowledged } from "../slice.ts";

const on = (at: number) => ({ agentId: "a", at });
const step = (st: RootState, ...events: (AgentEvent | ReturnType<typeof acknowledged>)[]) => events.reduce(rootReducer, st);
const init = step(rootReducer(undefined, { type: "init" }), agentAttached({ ...on(0), pid: 1, cwd: "/w" }));

test("完了は未確認になり、確認か次のターンで消える。中断・バックグラウンドが残る完了は未確認にしない", () => {
  const done = step(init, turnStarted(on(1)), turnFinished({ ...on(2), message: "終わり", background: false }));
  expect(selectUnseen(done, "a")).toBe(true);
  expect(selectUnseen(step(done, acknowledged(on(3))), "a")).toBe(false);
  expect(selectUnseen(step(done, turnStarted(on(3))), "a")).toBe(false);
  expect(selectUnseen(step(init, turnStarted(on(1)), turnInterrupted(on(2))), "a")).toBe(false);
  expect(selectUnseen(step(init, turnStarted(on(1)), turnFinished({ ...on(2), background: true })), "a")).toBe(false);
});

test("サブエージェントが2体許可を待つとき、片方が許可されても許可待ちのまま", () => {
  const x = { id: "x", type: "Explore" };
  const y = { id: "y", type: "Explore" };
  const st = step(
    init,
    turnStarted(on(1)),
    inputRequested({ ...on(2), subagent: x, kind: "permission", summary: "Bash: ls" }),
    inputRequested({ ...on(3), subagent: y, kind: "permission", summary: "Bash: pwd" }),
    toolUsed({ ...on(4), subagent: x, tool: "Bash" }),
  );
  const agent = st.app.agents.byId.a;
  if (!agent) throw new Error("エージェントがいない");
  expect(attentionOf(agent)).toMatchObject({ status: "waiting", subagent: { id: "y" } });
});

test("知らせる遷移とステータスラインの印", () => {
  const running = step(init, turnStarted(on(1)));
  const done = step(running, turnFinished({ ...on(2), message: "終わり", background: false }));
  expect(selectNotice(running, done, "a")).toEqual({ kind: "ready", reason: "終わり" });
  expect(selectNotice(rootReducer(undefined, { type: "init" }), init, "a")).toBeNull(); // 起動直後は知らせない
  const waiting = step(running, inputRequested({ ...on(2), kind: "permission", summary: "Bash: rm" }));
  expect(selectNotice(running, waiting, "a")).toEqual({ kind: "waiting", reason: "Bash: rm" });
  expect(selectStatusFlags(done)).toEqual({ waiting: false, asking: false, unseen: true, error: false });
  expect(selectStatusFlags(waiting)).toEqual({ waiting: true, asking: false, unseen: false, error: false });
});
