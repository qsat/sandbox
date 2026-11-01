export async function runInteractive(cmd: string, args: string[]) {
  return await Bun.spawn([cmd, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
}
