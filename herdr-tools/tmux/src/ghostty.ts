// Ghostty: tmux を表示する端末（macOS）。セッションの永続は持たない（1.4.0 時点）ので、tmux の窓として扱う。

import { platform } from "node:os";
import { run } from "@herdr-tools/ws-core";

const isMac = platform() === "darwin";

export async function focusGhostty(): Promise<void> {
  if (!isMac) return;
  await run("open", ["-a", "Ghostty"]);
}

/** tmux クライアントが1つも無いとき: Ghostty の新しいウィンドウで tmux attach（引数の渡し方は実機で確認） */
export async function ghosttyNewWindow(argv: string[]): Promise<void> {
  if (!isMac) throw new Error(`Ghostty の起動は macOS のみ対応です。手で実行してください: ${argv.join(" ")}`);
  await run("open", ["-na", "Ghostty", "--args", "-e", ...argv]);
}
