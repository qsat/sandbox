export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: Record<string, string | undefined>;
  /** この時間（ミリ秒）を過ぎたらプロセスを止め、終了コード 124（timeout コマンドと同じ）で返す。省けば待ち続ける */
  timeoutMs?: number;
}

export async function run(cmd: string, args: string[], opts: RunOptions = {}) {
  let proc;
  try {
    proc = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdin: opts.input !== undefined ? new Blob([opts.input]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e) };
  }
  let timedOut = false;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, opts.timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (timer) clearTimeout(timer);
  return timedOut ? { code: 124, stdout, stderr: `${stderr}${stderr && !stderr.endsWith("\n") ? "\n" : ""}${opts.timeoutMs} ms を過ぎたので止めた` } : { code, stdout, stderr };
}
