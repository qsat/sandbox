import { platform } from "node:os";
import { run } from "@herdr-tools/utils/run";

const isMac = platform() === "darwin";

export async function focusGhostty() {
  if (isMac) await run("open", ["-a", "Ghostty"]);
}

export async function openGhosttyWindowRunning(argv: string[]) {
  if (!isMac) throw new Error(`Ghostty の起動は macOS のみ対応です。手で実行してください: ${argv.join(" ")}`);
  await run("open", ["-na", "Ghostty", "--args", "-e", ...argv]);
}
