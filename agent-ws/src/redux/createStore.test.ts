import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

// ログの置き場所は読み込み時に決まるので、先に一時ディレクトリへ向けてから読み込む
const dir = mkdtempSync(join(tmpdir(), "agent-ws-test-"));
process.env.AGENT_WS_STATE_DIR = dir;
const { createStore, listen } = await import("./createStore.ts");
const { sessionListeners } = await import("./modules/app/sessions/listener.ts");
const { hookReceived, sessionsRequested } = await import("./modules/app/sessions/slice.ts");
const { navigationListeners } = await import("./modules/ui/navigation/listener.ts");
const { jumpRequested } = await import("./modules/ui/navigation/slice.ts");
const eventLog = await import("./infra/eventLog.ts");

test("意図は dispatch の中で listener が処理し、セッションのアクションはログに残る", () => {
  expect(eventLog.DIR).toBe(dir);
  const store = createStore();
  listen(store, sessionListeners());
  store.dispatch(hookReceived({ input: { hook_event_name: "SessionStart", session_id: "s1", cwd: dir }, at: 1 }));
  store.dispatch(hookReceived({ input: { hook_event_name: "UserPromptSubmit", session_id: "s1" }, at: 2 }));
  // dispatch から戻った時点で処理が終わっている（entry はこれに頼っている）
  expect(store.getState().app.sessions.s1).toMatchObject({ status: "running", since: 2 });

  // 別のプロセス（別の Store）はログから同じ状態を組み立てる
  const other = createStore();
  listen(other, sessionListeners());
  other.dispatch(sessionsRequested());
  expect(other.getState().app.sessions.s1).toEqual(store.getState().app.sessions.s1);
});

test("listener を登録しない Store では意図は何も起こさない（entry が要る分だけ登録する）", () => {
  const store = createStore();
  store.dispatch(sessionsRequested());
  expect(store.getState().app.sessions).toEqual({});
});

test("移動の結果は jumped で Store に戻る", () => {
  const store = createStore();
  listen(store, navigationListeners());
  store.dispatch(jumpRequested({ target: { title: "x", name: "x", path: "/nonexistent" }, create: false }));
  expect(store.getState().ui.navigation.lastJump).toEqual({ kind: "notFound", title: "x" });
});
