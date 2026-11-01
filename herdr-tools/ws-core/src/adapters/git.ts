// WorkspaceSource の実装: ghq（作業場所の一覧）と git（worktree と本体リポジトリ）。
// gwq の worktree は ~/ghq/<host>/<owner>/<repo>=<branch> に置かれるので ghq list に出る。

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "@herdr-tools/utils/expand-home";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { run } from "@herdr-tools/utils/run";
import type { PathInfo } from "../model";
import type { WorkspaceSource } from "../ports";

function isDir(p: string) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface GitSourceOptions {
  gitBin?: string;
  ghqBin?: string;
  /** 指定があれば ghq root の代わりに使う */
  root?: string;
}

export class GitWorkspaceSource implements WorkspaceSource {
  private readonly git: string;
  private readonly ghq: string;

  constructor(private readonly opts: GitSourceOptions = {}) {
    this.git = opts.gitBin ?? "git";
    this.ghq = opts.ghqBin ?? "ghq";
  }

  private rootCache?: Promise<string>;

  /** ghq root（プロセスの中では変わらないので1回だけ調べる） */
  root() {
    return (this.rootCache ??= this.findRoot());
  }

  private async findRoot() {
    if (this.opts.root) return expandHome(this.opts.root);
    const r = await run(this.ghq, ["root"]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().split("\n")[0]!;
    return join(homedir(), "ghq");
  }

  /** ghq の全エントリ。ghq が無い環境では root/<host>/<owner>/<repo> の3階層を走査する */
  async entries(root: string) {
    const r = await run(this.ghq, ["list", "--full-path"]);
    if (r.code === 0) return r.stdout.split("\n").filter(Boolean);
    if (!existsSync(root)) return [];
    const dirs = (p: string) => {
      try {
        return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
      } catch {
        return [];
      }
    };
    // <host>/<owner>/<repo>
    const below = (paths: string[]) => paths.flatMap((p) => dirs(p).map((d) => join(p, d.name)));
    return below(below(below([root])));
  }

  inspect(paths: string[]) {
    return mapLimit(paths, 16, (p) => this.inspectOne(p));
  }

  /** 1プロセスで toplevel / common dir / ブランチを取る */
  private async inspectOne(path: string) {
    if (!isDir(path)) return { path, exists: false };
    const r = await run(this.git, ["-C", path, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    if (r.code !== 0) {
      let real = path;
      try {
        real = realpathSync(path);
      } catch {}
      return { path, exists: true, toplevel: real };
    }
    const [toplevel = path, commonDir = "", branch = ""] = r.stdout.trim().split("\n");
    return { path, exists: true, toplevel, commonDir: commonDir || undefined, branch: branch && branch !== "HEAD" ? branch : null };
  }
}
