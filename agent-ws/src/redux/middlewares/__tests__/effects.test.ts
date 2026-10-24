import { expect, test } from "bun:test";
import { createStore } from "../../createStore.ts";
import { agentAttached, isAgentEvent, turnStarted } from "../../modules/app/agents/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import { always, effects, on } from "../effects.ts";

test("当てはまる反応を上から順にすべて呼ぶ。反応は reducer の後で、変わる前の状態も受け取る", () => {
  const seen: string[] = [];
  const store = createStore({
    effects: [
      effects((api) => [
        on(initialized, ({ payload }) => seen.push(`initialized ${payload.at} now=${api.getState().app.lifecycle.now}`)),
        on([initialized, ticked], (a, prev) => seen.push(`${a.type} prev=${prev.app.lifecycle.now}`)),
        on(isAgentEvent, (a) => seen.push(`agent ${a.payload.agentId}`)),
        always((a) => seen.push(`always ${a.type}`)),
      ]),
    ],
  });
  store.dispatch(initialized({ at: 1 }));
  store.dispatch(ticked({ at: 2 }));
  store.dispatch(agentAttached({ agentId: "a", at: 3, pid: null, cwd: "/" }));
  expect(seen).toEqual([
    "initialized 1 now=1",
    "lifecycle/initialized prev=0",
    "always lifecycle/initialized",
    "lifecycle/ticked prev=1",
    "always lifecycle/ticked",
    "agent a",
    "always agent/attached",
  ]);
});

test("反応の中で出した出来事も、同じ対応表で反応される", () => {
  const seen: string[] = [];
  const store = createStore({
    effects: [
      effects((api) => [
        on(agentAttached, ({ payload: { agentId, at } }) => api.dispatch(turnStarted({ agentId, at }))),
        on(turnStarted, ({ payload }) => seen.push(`turnStarted ${payload.agentId}`)),
      ]),
    ],
  });
  store.dispatch(agentAttached({ agentId: "a", at: 1, pid: null, cwd: "/" }));
  expect(seen).toEqual(["turnStarted a"]);
  expect(store.getState().app.agents.byId.a?.turn.status).toBe("running");
});
