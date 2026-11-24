import { platform } from "node:os";
import { run } from "@herdr-tools/utils/run";

const isMac = platform() === "darwin";

/**
 * Ghostty のウインドウのタイトルに入る、tmux のクライアントの tty の印。~/.tmux.conf の set-titles-string に `[#{client_tty}]` を入れる。
 * 括弧で囲むのは、/dev/ttys01 が /dev/ttys013 のタイトルにも当たらないようにするため
 */
export function ttyTitleMark(clientTty: string) {
  return `[${clientTty}]`;
}

/** yabai -m query --windows の結果のうち、タイトルにそのクライアントの tty の印がある Ghostty のウインドウの id */
export function ghosttyWindowIdShowing(windows: unknown, clientTty: string) {
  if (!Array.isArray(windows)) return undefined;
  const found = windows.find((w) => w?.app === "Ghostty" && typeof w.title === "string" && w.title.includes(ttyTitleMark(clientTty)));
  return typeof found?.id === "number" ? found.id : undefined;
}

async function yabaiWindows() {
  const r = await run("yabai", ["-m", "query", "--windows"]);
  if (r.code !== 0) return undefined;
  try {
    return JSON.parse(r.stdout) as unknown;
  } catch {
    return undefined;
  }
}

/** そのクライアントを表示している Ghostty のウインドウを前に出す。yabai で見つからなければ、Ghostty のアプリを前に出す */
export async function focusGhosttyWindowOf(clientTty: string) {
  if (!isMac) return;
  const windowId = ghosttyWindowIdShowing(await yabaiWindows(), clientTty);
  const focused = windowId !== undefined && (await run("yabai", ["-m", "window", "--focus", String(windowId)])).code === 0;
  if (!focused) await run("open", ["-a", "Ghostty"]);
}

export async function openGhosttyWindowRunning(argv: string[]) {
  if (!isMac) throw new Error(`Ghostty の起動は macOS のみ対応です。手で実行してください: ${argv.join(" ")}`);
  await run("open", ["-na", "Ghostty", "--args", "-e", ...argv]);
}
