// 子プロセス実行の薄いラッパ。

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: Record<string, string | undefined>;
}

export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
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
    // コマンドが見つからないなど
    return { code: 127, stdout: "", stderr: String(e) };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function runOk(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout;
}

/** 端末をそのまま引き継いで実行する（対話的なコマンド用） */
export async function runInteractive(cmd: string, args: string[]): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

/** 並列数を絞った map */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** sh に渡すための単一引用符クォート */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
