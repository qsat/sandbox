import { expect, test } from "bun:test";
import type { HookEvent, Pane, SessionRecord, Subagent } from "./domain.ts";
import { applyHook, detectAgent, findPane, repoName, settleInterrupted } from "./domain.ts";

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
  const waiting = applyHook(ev("PermissionRequest", { ...sub, tool_name: "Bash", tool_input: { command: "npm test" } }), none, 1);
  expect((waiting.session as SessionRecord).reason).toBe("[code-reviewer] Bash: npm test");
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

/** 本物の Claude Code（2.1.309）で取った hook 入力を順に流し、各イベント後の状態を記録する */
async function replay(file: string) {
  const text = await Bun.file(new URL(file, import.meta.url)).text();
  let session: SessionRecord | null = null;
  const subagents = new Map<string, Subagent>();
  return text.trim().split("\n").map((line, t) => {
    const e = JSON.parse(line) as HookEvent;
    const out = applyHook(e, { session, subagent: subagents.get(e.agent_id ?? "") ?? null }, t);
    if (out.subagent) subagents.set(out.subagent.id, out.subagent);
    session = out.session === "delete" ? null : (out.session ?? session);
    const subs = [...subagents.values()].map((a) => `${a.type}:${a.status}`).join(",");
    return { event: e.hook_event_name, status: session?.status, reason: session?.reason, subs, notify: Boolean(out.notify) };
  });
}

test("実データ: バックグラウンドのサブエージェントが許可を求め、許可されて完了する", async () => {
  const steps = await replay("./fixtures/claude-code-2.1.309.jsonl");
  const at = (event: string, nth = 0) => steps.filter((s) => s.event === event)[nth];

  // 本体のターンはサブエージェントを残して終わる（自動で再開するので通知しない）
  expect(at("Stop")).toMatchObject({ status: "ready", notify: false });
  // サブエージェントの許可待ちは本体にも出し、通知する
  expect(at("PermissionRequest")).toMatchObject({
    status: "waiting", reason: "[general-purpose] Bash: echo hi > b.txt", subs: "general-purpose:waiting", notify: true,
  });
  // 後から来る Notification（agent_id も詳細も無い）で理由を上書きしない
  expect(at("Notification")).toMatchObject({ status: "waiting", reason: "[general-purpose] Bash: echo hi > b.txt", notify: false });
  // 許可されたら本体は許可待ちの前（ready）に戻る。通知はしない
  expect(at("PostToolUse", 1)).toMatchObject({ status: "ready", subs: "general-purpose:running", notify: false });
  // サブエージェントの結果で本体が自動で再開し、完了で通知する
  expect(at("Stop", 1)).toMatchObject({ status: "ready", reason: "完了しました。`echo hi > b.txt` はエラーなしで実行されました（ファイルの中身は開いて確認していません）。", notify: true });
  // agent_type が空の内部用エージェントはサブエージェントとして数えない
  expect(at("SubagentStop", 1).subs).toBe("general-purpose:done");
  expect(steps.at(-1)).toMatchObject({ event: "SessionEnd", status: undefined });
});

test("applyHook: 本体の許可待ちはツールの実行で running に戻る", () => {
  const waiting = applyHook(ev("PermissionRequest", { tool_name: "Edit", tool_input: { file_path: "/w/a.ts" } }), none, 1);
  expect(waiting.session).toMatchObject({ status: "waiting", reason: "Edit: /w/a.ts" });
  const resumed = applyHook(ev("PostToolUse", { tool_name: "Edit" }), { ...none, session: waiting.session as SessionRecord }, 2);
  expect(resumed.session).toMatchObject({ status: "running" });
});

test("settleInterrupted: 会話ログの末尾が中断（Esc・許可の拒否）なら入力待ちに戻す", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const entry = (type: string, text: string, ms: number) => JSON.stringify({ type, timestamp: at(ms), message: { content: [{ type: "text", text }] } });
  const waiting: SessionRecord = { id: "s", pid: 1, cwd: "/w", status: "waiting", reason: "Bash: rm", since: 1_000, updated: 1_000 };
  const denied = [entry("assistant", "消します", 1_500), entry("user", "[Request interrupted by user for tool use]", 2_000), "{\"type\":\"last-prompt\"}"];

  expect(settleInterrupted(waiting, denied, 3_000)).toMatchObject({ status: "ready", reason: "中断しました", since: 3_000 });
  expect(settleInterrupted(waiting, [entry("assistant", "消します", 1_500)], 3_000)).toBeNull();
  // 前のターンの中断（この状態になる前の記録）は無視する
  expect(settleInterrupted({ ...waiting, since: 2_500 }, denied, 3_000)).toBeNull();
  expect(settleInterrupted({ ...waiting, status: "ready" }, denied, 3_000)).toBeNull();
});
