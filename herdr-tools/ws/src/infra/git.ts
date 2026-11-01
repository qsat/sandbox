// git / ghq / Ghostty との境界。

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { PathInfo } from "../domain";
import { mapLimit, run } from "./exec";

const GIT_BIN = process.env.GIT_BIN || "git";
const GHQ_BIN = process.env.GHQ_BIN || "ghq";

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** パス1つを git で調べる。1プロセスで toplevel / common dir / ブランチを取る */
export async function pathInfo(path: string): Promise<PathInfo> {
  if (!isDir(path)) return { path, exists: false };
  const r = await run(GIT_BIN, ["-C", path, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
  if (r.code !== 0) {
    let real = path;
    try {
      real = realpathSync(path);
    } catch {}
    return { path, exists: true, toplevel: real };
  }
  const [toplevel = path, commonDir = "", branch = ""] = r.stdout.trim().split("\n");
  return {
    path,
    exists: true,
    toplevel,
    commonDir: commonDir || undefined,
    branch: branch && branch !== "HEAD" ? branch : null,
  };
}

export async function pathInfos(paths: string[]): Promise<PathInfo[]> {
  return mapLimit(paths, 16, pathInfo);
}

export async function ghqRoot(): Promise<string> {
  if (process.env.GHQ_ROOT) return expandHome(process.env.GHQ_ROOT);
  const r = await run(GHQ_BIN, ["root"]);
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().split("\n")[0]!;
  return join(homedir(), "ghq");
}

/**
 * ghq の全エントリ（gwq の worktree は ~/ghq/<host>/<owner>/<repo>=<branch> なのでここに出る）。
 * ghq が無い環境では root/<host>/<owner>/<repo> の3階層を走査する。
 */
export async function ghqList(root: string): Promise<string[]> {
  const r = await run(GHQ_BIN, ["list", "--full-path"]);
  if (r.code === 0) return r.stdout.split("\n").filter(Boolean);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const dirs = (p: string) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
    } catch {
      return [];
    }
  };
  for (const h of dirs(root)) for (const o of dirs(join(root, h.name))) for (const repo of dirs(join(root, h.name, o.name))) out.push(join(root, h.name, o.name, repo.name));
  return out;
}

// ---------------------------------------------------------------------------
// Ghostty（macOS）
// ---------------------------------------------------------------------------

const isMac = platform() === "darwin";

export async function focusGhostty(): Promise<void> {
  if (!isMac) return;
  await run("open", ["-a", "Ghostty"]);
}

/** tmux クライアントが1つも無いとき: Ghostty の新しいウィンドウで tmux attach（引数の渡し方は実機で確認） */
export async function ghosttyNewWindow(argv: string[]): Promise<void> {
  if (!isMac) throw new Error(`Ghostty の起動は macOS のみ対応です。手で実行してください: ${argv.join(" ")}`);
  await run("open", ["-na", "Ghostty", "--args", "-e", ...argv]);
}
