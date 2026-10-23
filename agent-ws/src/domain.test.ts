import { expect, test } from "bun:test";
import type { HookEvent, Pane, SessionRecord, Subagent } from "./domain.ts";
import { applyHook, detectAgent, findPane, repoName } from "./domain.ts";

test("detectAgent: 実行ファイル名・ランタイム経由のスクリプトで判定する", () => {
  expect(detectAgent("claude --resume")).toBe("claude");
  expect(detectAgent("node /x/node_modules/@openai/codex/bin/codex.js")).toBe("codex");
  expect(detectAgent("/bin/bash -c exec -a claude sleep 30")).toBeNull(); // 引数中の名前には反応しない
});

test("repoName: ghq root からの相対名", () => {
  expect(repoName("/g/github.com/acme/api", ["/g"])).toBe("github.com/acme/api");
  expect(repoName("/elsewhere/api", ["/g"])).toBe("/elsewhere/api");
});

const ev = (hook_event_name: string, extra: Partial<HookEvent> = {}): HookEvent => ({ hook_event_name, session_id: "s", cwd: "/w", ...extra });
const none = { session: null, subagent: null };

test("applyHook: 起動直後は通知せず、ターン完了・許可待ちは通知する", () => {
  const start = applyHook(ev("SessionStart"), none, 1);
  expect((start.session as SessionRecord).status).toBe("ready");
  expect(start.notify).toBe(false);

  const running = applyHook(ev("UserPromptSubmit"), { ...none, session: start.session as SessionRecord }, 2);
  const done = applyHook(ev("Stop", { last_assistant_message: "直しました\n詳細" }), { ...none, session: running.session as SessionRecord }, 3);
  expect([(done.session as SessionRecord).reason, done.notify]).toEqual(["直しました", true]);
});

test("applyHook: サブエージェントの許可待ちは本体にも反映し、ツール実行で解除する", () => {
  const sub = { agent_id: "a1", agent_type: "code-reviewer" };
  const waiting = applyHook(ev("Notification", { ...sub, message: "Bash を許可しますか" }), none, 1);
  expect((waiting.session as SessionRecord).reason).toBe("[code-reviewer] Bash を許可しますか");
  expect(waiting.subagent?.status).toBe("waiting");

  const prev = { session: waiting.session as SessionRecord, subagent: waiting.subagent as Subagent };
  const resumed = applyHook(ev("PostToolUse", { ...sub, tool_name: "Bash" }), prev, 2);
  expect((resumed.session as SessionRecord).status).toBe("running");
  expect([resumed.subagent?.status, resumed.subagent?.detail]).toEqual(["running", "Bash"]);
});

test("findPane: pid の祖先 → パスの順で探す", () => {
  const pane = (id: string, pid: number, path: string): Pane => ({ id, pid, path, session: "s", window: "0", windowName: "w", active: false });
  const panes = [pane("%1", 100, "/w/a"), pane("%2", 200, "/w/b")];
  const parent = new Map([[300, 250], [250, 200]]);
  expect(findPane({ title: "", name: "", pid: 300 }, panes, (p) => parent.get(p))?.id).toBe("%2");
  expect(findPane({ title: "", name: "", path: "/w/a" }, panes, () => undefined)?.id).toBe("%1");
});
