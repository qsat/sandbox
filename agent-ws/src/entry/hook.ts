import { appendFileSync } from "node:fs";
import { claude, hookReceived } from "../redux/middlewares/claude/index.ts";
import { tmux } from "../redux/middlewares/tmux/index.ts";
import { notifier } from "../redux/subscribers/notifier/index.ts";
import { statusLine } from "../redux/subscribers/statusLine.ts";
import type { NoticeKind } from "../redux/types/attention.ts";
import { notification } from "../ui/view.ts";
import { start } from "./store.ts";

/** hook の入力を1件受け付ける（1回の hook の起動に当たる） */
export function receiveHook(input: unknown, at = Date.now()): void {
  const kinds = (process.env.AGENT_WS_NOTIFY ?? "waiting,asking,ready,error").split(",") as NoticeKind[];
  const store = start([claude(), tmux()], { subscribers: [statusLine(), notifier({ kinds, format: notification })] });
  store.dispatch(hookReceived({ input, at }));
}

/** Claude Code の hook から呼ばれる。失敗しても Claude Code の動作は止めない */
export async function runHook(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    // 入力の確認用: 受け取った JSON をそのまま1行ずつ追記する
    if (process.env.AGENT_WS_DUMP) appendFileSync(process.env.AGENT_WS_DUMP, `${input.replace(/\n/g, " ")}\n`);
    receiveHook(JSON.parse(input || "{}"));
  } catch {
    /* 無視 */
  }
}
