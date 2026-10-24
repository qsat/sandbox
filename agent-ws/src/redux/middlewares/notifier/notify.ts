import { run } from "../shared/shell.ts";
import { displayMessage } from "../tmux/tmux.ts";

/** tmux のメッセージとデスクトップ通知（hook は端末を持たないので /dev/tty には書けない） */
export function notify(title: string, body: string): void {
  if (process.env.TMUX) displayMessage(`${title}  ${body}`);
  const q = (s: string) => JSON.stringify(s); // AppleScript の文字列リテラルとして安全
  if (process.platform === "darwin") run("osascript", ["-e", `display notification ${q(body)} with title ${q(title)} sound name "Glass"`]);
  else run("notify-send", ["-a", "agent-ws", title, body]);
}
