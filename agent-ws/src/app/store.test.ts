import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ログの置き場所は読み込み時に決まるので、先に一時ディレクトリへ向けてから読み込む
const dir = mkdtempSync(join(tmpdir(), "agent-ws-test-"));
process.env.AGENT_WS_STATE_DIR = dir;
const { createAppStore } = await import("./store.ts");
const intent = await import("./intents.ts");
const eventLog = await import("../infra/eventLog.ts");

test("意図は dispatch の中で listener が処理し、セッションのアクションはログに残る", () => {
  expect(eventLog.DIR).toBe(dir);
  const store = createAppStore();
  store.dispatch(intent.hookReceived({ input: { hook_event_name: "SessionStart", session_id: "s1", cwd: dir }, at: 1 }));
  store.dispatch(intent.hookReceived({ input: { hook_event_name: "UserPromptSubmit", session_id: "s1" }, at: 2 }));
  // dispatch から戻った時点で処理が終わっている（CLI はこれに頼っている）
  expect(store.getState().sessions.s1).toMatchObject({ status: "running", since: 2 });

  // 別のプロセス（別の Store）はログから同じ状態を組み立てる
  const other = createAppStore();
  other.dispatch(intent.sessionsRequested());
  expect(other.getState().sessions.s1).toEqual(store.getState().sessions.s1);
});

test("移動の結果は jumped で Store に戻る", () => {
  const store = createAppStore();
  store.dispatch(intent.jumpRequested({ target: { title: "x", name: "x", path: "/nonexistent" }, create: false }));
  expect(store.getState().navigation.lastJump).toEqual({ kind: "notFound", title: "x" });
});
