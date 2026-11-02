import { run, type RunOptions } from "./run";

export async function runOk(cmd: string, args: string[], opts: RunOptions = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}
