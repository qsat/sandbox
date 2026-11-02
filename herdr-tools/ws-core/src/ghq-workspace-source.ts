import { readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "@herdr-tools/utils/expand-home";
import { mapLimit } from "@herdr-tools/utils/map-limit";
import { run } from "@herdr-tools/utils/run";
import type { WorkspaceSource } from "./ports";

export class GhqWorkspaceSource implements WorkspaceSource {
  private rootOnce?: Promise<string>;

  constructor(private readonly bins: { git?: string; ghq?: string; ghqRoot?: string } = {}) {}

  root() {
    return (this.rootOnce ??= this.findRoot());
  }

  private async findRoot() {
    if (this.bins.ghqRoot) return expandHome(this.bins.ghqRoot);
    const r = await run(this.bins.ghq ?? "ghq", ["root"]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0]! : join(homedir(), "ghq");
  }

  async entries(root: string) {
    const r = await run(this.bins.ghq ?? "ghq", ["list", "--full-path"]);
    if (r.code === 0) return r.stdout.split("\n").filter(Boolean);
    const subdirs = (paths: string[]) => paths.flatMap((p) => visibleDirs(p).map((name) => join(p, name)));
    const hosts = subdirs([root]);
    const owners = subdirs(hosts);
    return subdirs(owners);
  }

  inspect(paths: string[]) {
    return mapLimit(paths, 16, (p) => this.inspectOne(p));
  }

  private async inspectOne(path: string) {
    if (!isDir(path)) return { path, exists: false };
    const r = await run(this.bins.git ?? "git", ["-C", path, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    if (r.code !== 0) return { path, exists: true, toplevel: realpathSync(path) };
    const [toplevel = path, commonDir = "", branch = ""] = r.stdout.trim().split("\n");
    return { path, exists: true, toplevel, commonDir: commonDir || undefined, branch: branch && branch !== "HEAD" ? branch : null };
  }
}

function isDir(p: string) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function visibleDirs(p: string) {
  try {
    return readdirSync(p, { withFileTypes: true }).flatMap((d) => (d.isDirectory() && !d.name.startsWith(".") ? [d.name] : []));
  } catch {
    return [];
  }
}
