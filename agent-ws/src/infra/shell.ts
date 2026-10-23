import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/** コマンドを実行して stdout を返す。失敗したら null */
export function run(cmd: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  } catch {
    return null;
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
