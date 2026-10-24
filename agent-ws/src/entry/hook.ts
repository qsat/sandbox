import { appendFileSync } from "node:fs";
import { claude, hookReceived } from "../redux/middlewares/claude/index.ts";
import { notifier } from "../redux/middlewares/notifier/index.ts";
import { tmux } from "../redux/middlewares/tmux/index.ts";
import type { NoticeKind } from "../redux/types/attention.ts";
import { notification } from "../ui/view.ts";
import { storeWith } from "./store.ts";

/** Claude Code の hook から呼ばれる。失敗しても Claude Code の動作は止めない */
export async function runHook(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    // 入力の確認用: 受け取った JSON をそのまま1行ずつ追記する
    if (process.env.AGENT_WS_DUMP) appendFileSync(process.env.AGENT_WS_DUMP, `${input.replace(/\n/g, " ")}\n`);
    const kinds = (process.env.AGENT_WS_NOTIFY ?? "waiting,asking,ready,error").split(",") as NoticeKind[];
    const store = storeWith(claude(), tmux(), notifier({ kinds, format: notification }));
    store.dispatch(hookReceived({ input: JSON.parse(input || "{}"), at: Date.now() }));
  } catch {
    /* 無視 */
  }
}
