import { realpathSync } from "node:fs";

/** コマンドを実行して stdout を返す。失敗したら null */
export function run(cmd: string, args: string[], cwd?: string): string | null {
  try {
    const r = Bun.spawnSync([cmd, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5000 });
    if (!r.success) return null;
    return r.stdout.toString();
  } catch {
    return null; // コマンドが無い
  }
}

export const lines = (out: string | null) => (out ?? "").split("\n").filter(Boolean);

export function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
