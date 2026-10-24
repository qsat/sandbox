import { run } from "../../lib/run.ts";
import { displayMessage } from "./tmux.ts";

export interface NotifyOptions {
  inTmux: boolean; // tmux の中なら tmux のメッセージも出す
  platform: string; // darwin なら osascript、それ以外は notify-send
}

/** tmux のメッセージとデスクトップ通知（hook は端末を持たないので /dev/tty には書けない） */
export function notify(title: string, body: string, o: NotifyOptions): void {
  if (o.inTmux) displayMessage(`${title}  ${body}`);
  const q = (s: string) => JSON.stringify(s); // AppleScript の文字列リテラルとして安全
  if (o.platform === "darwin") {
    run("osascript", ["-e", `display notification ${q(body)} with title ${q(title)} sound name "Glass"`]);
    return;
  }
  run("notify-send", ["-a", "agent-ws", title, body]);
}
