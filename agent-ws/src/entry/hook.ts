import { appendFileSync } from "node:fs";
import { notify } from "../redux/infra/notify.ts";
import { notificationListeners } from "../redux/modules/app/notification/listener.ts";
import { sessionListeners } from "../redux/modules/app/sessions/listener.ts";
import { hookReceived } from "../redux/modules/app/sessions/slice.ts";
import { statusLineListeners } from "../redux/modules/ui/statusLine/listener.ts";
import type { HookInput } from "../redux/types/hook.ts";
import { notification } from "../ui/view.ts";
import { initStore } from "./store.ts";

/** Claude Code の hook から呼ばれる。失敗しても Claude Code の動作は止めない */
export async function runHook(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    // 入力の確認用: 受け取った JSON をそのまま1行ずつ追記する
    if (process.env.AGENT_WS_DUMP) appendFileSync(process.env.AGENT_WS_DUMP, `${input.replace(/\n/g, " ")}\n`);
    const notifyOn = (process.env.AGENT_WS_NOTIFY ?? "waiting,asking,ready,error").split(",");
    const store = initStore(
      sessionListeners(),
      statusLineListeners(),
      notificationListeners((n) => {
        if (!notifyOn.includes(n.kind)) return;
        const { title, body } = notification(n);
        notify(title, body);
      }),
    );
    store.dispatch(hookReceived({ input: JSON.parse(input || "{}") as HookInput, at: Date.now() }));
  } catch { /* 無視 */ }
}
