/** 端末をそのまま引き継いで実行する（対話的なコマンド用）。終了コードを返す */
export async function runInteractive(cmd: string, args: string[]): Promise<number> {
  return await Bun.spawn([cmd, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
}
