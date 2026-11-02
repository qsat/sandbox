export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: Record<string, string | undefined>;
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
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}
