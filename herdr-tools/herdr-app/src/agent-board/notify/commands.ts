// macOS の通知を出すコマンドと引数。terminal-notifier（クリックで会話へ移れる）と osascript（移れない）。I/O なし
import { shellQuote } from "@herdr-tools/utils/shell-quote";
import type { NotificationMessage } from "./message";

/** osascript の引数。題名・副題・本文は argv で渡し、AppleScript の文字列に埋め込まない（引用符を含んでも壊れない） */
export function osascriptArgs(message: NotificationMessage) {
  return [
    "-e",
    "on run argv",
    "-e",
    "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
    "-e",
    "end run",
    "--",
    message.title,
    message.subtitle,
    message.body,
  ];
}

/**
 * 通知をクリックしたときに terminal-notifier が実行するシェルのコマンド。ws go <エージェント> --from-app で、
 * tmux の会話ペインへ移り Ghostty を前に出す。terminal-notifier のシェルは PATH が短いので、
 * ws と、ws が呼ぶ tmux・hc・ghq・git が見つかる PATH を書く（skhd の設定例 tmux/config/skhdrc と同じ事情）
 */
export function goOnClickCommand(agentKey: string, home: string) {
  const path = [`${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  return `PATH=${shellQuote(path)} ws go ${shellQuote(agentKey)} --from-app`;
}

/**
 * 通知を出すコマンドを、試す順に返す。terminal-notifier（クリックでその会話へ移れる）を先に、
 * 見つからなければ osascript（クリックしても移れない）。Herdr app の PATH に Homebrew が入っていないこともあるので、
 * terminal-notifier はよくある場所を絶対パスで先に試す。同じエージェントの通知は group で 1 つにまとめる
 */
export function notifyCommands(message: NotificationMessage, agentKey: string, home: string): [string, string[]][] {
  // terminal-notifier は、本文が [ で始まると読めないことがあるので \ を前に付ける（terminal-notifier -help の注意書き）
  const body = message.body.startsWith("[") ? `\\${message.body}` : message.body;
  const tnArgs = [
    "-title",
    message.title,
    "-subtitle",
    message.subtitle,
    "-message",
    body,
    "-group",
    `herdr-tools.${agentKey}`,
    "-execute",
    goOnClickCommand(agentKey, home),
  ];
  return [
    ["/opt/homebrew/bin/terminal-notifier", tnArgs],
    ["/usr/local/bin/terminal-notifier", tnArgs],
    ["terminal-notifier", tnArgs],
    ["osascript", osascriptArgs(message)],
  ];
}
