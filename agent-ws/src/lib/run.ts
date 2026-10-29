/**
 * 外部コマンドの実行とパスの実体（ドメインを知らない I/O の道具）
 */
import { realpathSync } from "node:fs";
import { attempt } from "./attempt.ts";

/** コマンドを実行して stdout を返す。失敗した・コマンドが無ければ null */
export function run(cmd: string, args: string[], cwd?: string): string | null {
  return attempt(() => {
    const r = Bun.spawnSync([cmd, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5000 });
    if (!r.success) return null;
    return r.stdout.toString();
  }, null);
}

export const lines = (out: string | null) => (out ?? "").split("\n").filter(Boolean);

/** シンボリックリンクを辿った実体（無ければそのまま） */
export const realPath = (p: string): string => attempt(() => realpathSync(p), p);
