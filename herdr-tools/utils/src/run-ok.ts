import { run, type RunOptions } from "./run";

/** 子プロセスを実行して標準出力を返す。失敗したら例外 */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}
