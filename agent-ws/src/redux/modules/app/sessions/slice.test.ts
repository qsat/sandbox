import { expect, test } from "bun:test";
import type { RootState } from "../../../createStore.ts";
import { noticeOf } from "../notification/selector.ts";
import { selectStatusFlags } from "../../ui/statusLine/selector.ts";
import { attention } from "./selector.ts";
import type { SessionAction, SessionsState } from "./slice.ts";
import {
  attached, interrupted, logReplayed, permissionRequested, promptSubmitted, seen, sessionsReducer, stopped, toolUsed,
} from "./slice.ts";

const on = (at: number) => ({ sessionId: "s", at });
const init = sessionsReducer(undefined, { type: "init" });
const run = (...actions: SessionAction[]) => actions.reduce<SessionsState>(sessionsReducer, init);
const born = attached({ ...on(0), pid: 1, cwd: "/w" });

test("状態が変わらないアクションは同じ参照を返す（ログに残さない判定に使う）", () => {
  const running = run(born, promptSubmitted(on(1)));
  expect(sessionsReducer(running, toolUsed({ ...on(2), tool: "Bash" })).s).toBe(running.s);
  expect(sessionsReducer(running, seen(on(3))).s).toBe(running.s);
});

test("本体の許可待ちはツールの実行で running に戻り、AskUserQuestion は質問待ち", () => {
  const waiting = run(born, promptSubmitted(on(1)), permissionRequested({ ...on(2), summary: "Edit: /w/a.ts", question: false }));
  expect(waiting.s).toMatchObject({ status: "waiting", reason: "Edit: /w/a.ts" });
  expect(sessionsReducer(waiting, toolUsed({ ...on(3), tool: "Edit" })).s?.status).toBe("running");
  expect(run(born, permissionRequested({ ...on(1), summary: "AskUserQuestion", question: true })).s?.status).toBe("asking");
});

test("サブエージェントが2体許可を待つとき、片方が許可されても本体は許可待ちのまま", () => {
  const a = { id: "a", type: "Explore" };
  const b = { id: "b", type: "Explore" };
  const st = run(
    born, promptSubmitted(on(1)),
    permissionRequested({ ...on(2), agent: a, summary: "Bash: ls", question: false }),
    permissionRequested({ ...on(3), agent: b, summary: "Bash: pwd", question: false }),
    toolUsed({ ...on(4), agent: a, tool: "Bash" }),
  );
  expect(attention(st.s!)).toMatchObject({ status: "waiting", subagent: { id: "b" } });
});

test("完了は未確認になり、見るか次のプロンプトで消える。中断は未確認にしない", () => {
  const done = run(born, promptSubmitted(on(1)), stopped({ ...on(2), message: "終わり", background: false }));
  expect(done.s).toMatchObject({ status: "ready", reason: "終わり", unseen: true });
  expect(sessionsReducer(done, seen(on(3))).s?.unseen).toBe(false);
  expect(sessionsReducer(done, promptSubmitted(on(3))).s?.unseen).toBe(false);
  const stopped_ = run(born, promptSubmitted(on(1)), interrupted(on(2)));
  expect(stopped_.s).toMatchObject({ status: "ready", reason: "中断しました", unseen: false });
});

test("ログの流し直しはスナップショットから続きを適用する", () => {
  const actions = [born, promptSubmitted(on(1))];
  const base = run(...actions).s!;
  const replayed = sessionsReducer(init, logReplayed({ sessionId: "s", base, actions: [stopped({ ...on(2), background: false })] }));
  expect(replayed.s).toMatchObject({ status: "ready", unseen: true, since: 2 });
});

test("noticeOf / selectStatusFlags: 通知とステータスラインの印", () => {
  const running = run(born, promptSubmitted(on(1)));
  const done = sessionsReducer(running, stopped({ ...on(2), message: "終わり", background: false }));
  expect(noticeOf(running.s, done.s)).toEqual({ kind: "ready", reason: "終わり" });
  expect(noticeOf(undefined, run(born).s)).toBeNull(); // 起動直後は通知しない
  expect(selectStatusFlags({ app: { sessions: done } } as RootState)).toEqual({ waiting: false, asking: false, unseen: true, error: false });
});
