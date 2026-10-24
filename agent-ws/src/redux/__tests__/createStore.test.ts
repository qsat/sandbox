import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppMiddleware, createStore } from "../createStore.ts";
import { claude, hookReceived } from "../middlewares/claude/index.ts";
import { clock } from "../middlewares/clock/index.ts";
import { eventLog } from "../middlewares/eventLog/index.ts";
import { tmux } from "../middlewares/tmux/index.ts";
import { agentAttached, turnFinished, turnStarted } from "../modules/app/agents/slice.ts";
import { selectUnseen } from "../modules/app/attention/selector.ts";
import { acknowledged } from "../modules/app/attention/slice.ts";
import { initialized, ticked } from "../modules/app/lifecycle/slice.ts";
import { visitRequested } from "../modules/ui/visit/slice.ts";

const dir = mkdtempSync(join(tmpdir(), "agent-ws-test-"));
const hook = (input: Record<string, unknown>, at: number) => hookReceived({ input: { session_id: "s1", cwd: dir, ...input }, at });

test("hook の入力は middleware が出来事に変えてログに残し、別の Store がログから同じ状態を組み立てる", () => {
  const store = createStore({ log: eventLog({ dir }), effects: [claude()] });
  store.dispatch(initialized({ at: 0 }));
  store.dispatch(hook({ hook_event_name: "SessionStart" }, 1));
  store.dispatch(hook({ hook_event_name: "UserPromptSubmit" }, 2));
  store.dispatch(hook({ hook_event_name: "Stop", last_assistant_message: "終わり" }, 3));
  // dispatch から戻った時点で I/O まで終わっている（entry はこれに頼っている）
  expect(store.getState().app.agents.byId.s1?.turn).toMatchObject({ status: "ready", reason: "終わり", since: 3 });
  expect(selectUnseen(store.getState(), "s1")).toBe(true);

  // 別のプロセス（別の Store）はログから同じ状態を組み立てる。確認（acknowledged）もログに残る
  store.dispatch(acknowledged({ agentId: "s1", at: 4 }));
  const other = createStore({ log: eventLog({ dir }) });
  other.dispatch(initialized({ at: 9 }));
  expect(other.getState().app).toEqual({ ...store.getState().app });
});

test("middleware を組まない Store では、起動しても何も起こらない（何をするかは組んだ middleware が決める）", () => {
  const store = createStore();
  store.dispatch(initialized({ at: 1 }));
  expect(store.getState().app.agents.byId).toEqual({});
});

test("移動の結果は visited で Store に戻る", () => {
  const store = createStore({ effects: [tmux()] });
  store.dispatch(visitRequested({ target: { title: "x", name: "x", path: "/nonexistent" }, create: false }));
  expect(store.getState().ui.visit.last).toEqual({ kind: "notFound", title: "x" });
});

test("effects が出来事の途中で出した出来事は、元の出来事より後に記録される（流し直しても同じ状態になる）", () => {
  const logDir = mkdtempSync(join(tmpdir(), "agent-ws-test-"));
  // 表示中のペインで完了したときの tmux のように、完了の途中で確認を出す
  const seesIt: AppMiddleware = (api) => (next) => (action) => {
    const result = next(action);
    if (turnFinished.match(action)) api.dispatch(acknowledged({ agentId: action.payload.agentId, at: action.payload.at }));
    return result;
  };
  const store = createStore({ log: eventLog({ dir: logDir }), effects: [seesIt] });
  store.dispatch(agentAttached({ agentId: "a", at: 1, pid: null, cwd: dir }));
  store.dispatch(turnStarted({ agentId: "a", at: 2 }));
  store.dispatch(turnFinished({ agentId: "a", at: 3, background: false }));
  expect(selectUnseen(store.getState(), "a")).toBe(false);

  const other = createStore({ log: eventLog({ dir: logDir }) });
  other.dispatch(initialized({ at: 9 }));
  expect(selectUnseen(other.getState(), "a")).toBe(false);
});

test("clock は起動すると interval ごとに時間の経過を出す", async () => {
  const seen: string[] = [];
  const record: AppMiddleware = () => (next) => (action) => {
    if (ticked.match(action)) seen.push(action.type);
    return next(action);
  };
  const store = createStore({ effects: [record, clock({ intervalMs: 10 })] });
  await Bun.sleep(30);
  expect(seen).toEqual([]); // 起動するまでは出さない
  store.dispatch(initialized({ at: 0 }));
  await Bun.sleep(35);
  expect(seen.length).toBeGreaterThanOrEqual(2);
});
