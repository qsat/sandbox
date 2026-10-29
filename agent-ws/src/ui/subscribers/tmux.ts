/**
 * tmux に見せる: ステータスラインの描き直しとメッセージ（表示のためのコマンドだけ。移動などは tmux の listener）
 */
import { lines, run } from "../../lib/run.ts";

/** 全クライアントのステータスラインを描き直す（status-interval を待たずに反映する。`#()` も再実行される） */
export function refreshStatus(): void {
  for (const client of lines(run("tmux", ["list-clients", "-F", "#{client_name}"]))) run("tmux", ["refresh-client", "-S", "-t", client]);
}

export const displayMessage = (text: string) => run("tmux", ["display-message", "-d", "5000", text]);
