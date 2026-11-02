const CHILD_OWNED_SIGNALS = ["SIGINT", "SIGQUIT"] as const;

export async function runInteractive(cmd: string, args: string[]) {
  const leaveToChild = () => {};
  for (const s of CHILD_OWNED_SIGNALS) process.on(s, leaveToChild);
  try {
    return await Bun.spawn([cmd, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
  } finally {
    for (const s of CHILD_OWNED_SIGNALS) process.off(s, leaveToChild);
  }
}
