import assert from "node:assert/strict";
import { test } from "node:test";
import type { HookEvent, Pane, SessionRecord, Subagent } from "./domain.ts";
import { applyHook, detectAgent, findPane, repoName } from "./domain.ts";

test("detectAgent: 実行ファイル名・ランタイム経由のスクリプトで判定する", () => {
  assert.equal(detectAgent("claude --resume"), "claude");
  assert.equal(detectAgent("node /x/node_modules/@openai/codex/bin/codex.js"), "codex");
  assert.equal(detectAgent("/bin/bash -c exec -a claude sleep 30"), null); // 引数中の名前には反応しない
});

test("repoName: ghq root からの相対名", () => {
  assert.equal(repoName("/g/github.com/acme/api", ["/g"]), "github.com/acme/api");
  assert.equal(repoName("/elsewhere/api", ["/g"]), "/elsewhere/api");
});

const ev = (hook_event_name: string, extra: Partial<HookEvent> = {}): HookEvent => ({ hook_event_name, session_id: "s", cwd: "/w", ...extra });
const none = { session: null, subagent: null };

test("applyHook: 起動直後は通知せず、ターン完了・許可待ちは通知する", () => {
  const start = applyHook(ev("SessionStart"), none, 1);
  assert.equal((start.session as SessionRecord).status, "ready");
  assert.equal(start.notify, false);

  const running = applyHook(ev("UserPromptSubmit"), { ...none, session: start.session as SessionRecord }, 2);
  const done = applyHook(ev("Stop", { last_assistant_message: "直しました\n詳細" }), { ...none, session: running.session as SessionRecord }, 3);
  assert.deepEqual([(done.session as SessionRecord).reason, done.notify], ["直しました", true]);
});

test("applyHook: サブエージェントの許可待ちは本体にも反映し、ツール実行で解除する", () => {
  const sub = { agent_id: "a1", agent_type: "code-reviewer" };
  const waiting = applyHook(ev("Notification", { ...sub, message: "Bash を許可しますか" }), none, 1);
  assert.equal((waiting.session as SessionRecord).reason, "[code-reviewer] Bash を許可しますか");
  assert.equal(waiting.subagent?.status, "waiting");

  const prev = { session: waiting.session as SessionRecord, subagent: waiting.subagent as Subagent };
  const resumed = applyHook(ev("PostToolUse", { ...sub, tool_name: "Bash" }), prev, 2);
  assert.equal((resumed.session as SessionRecord).status, "running");
  assert.deepEqual([resumed.subagent?.status, resumed.subagent?.detail], ["running", "Bash"]);
});

test("findPane: pid の祖先 → パスの順で探す", () => {
  const pane = (id: string, pid: number, path: string): Pane => ({ id, pid, path, session: "s", window: "0", windowName: "w", active: false });
  const panes = [pane("%1", 100, "/w/a"), pane("%2", 200, "/w/b")];
  const parent = new Map([[300, 250], [250, 200]]);
  assert.equal(findPane({ title: "", name: "", pid: 300 }, panes, (p) => parent.get(p))?.id, "%2");
  assert.equal(findPane({ title: "", name: "", path: "/w/a" }, panes, () => undefined)?.id, "%1");
});
