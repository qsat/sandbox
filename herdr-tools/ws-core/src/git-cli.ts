import { GIT_READ_ARGS } from "@herdr-tools/utils/git-read-args";
import { run } from "@herdr-tools/utils/run";

export class GitCli {
  constructor(readonly bin = "git") {}

  run(cwd: string, args: string[]) {
    return run(this.bin, ["-C", cwd, ...args]);
  }

  read(cwd: string, args: string[]) {
    return this.run(cwd, [...GIT_READ_ARGS, ...args]);
  }

  async ok(cwd: string, args: string[]) {
    const r = await this.run(cwd, args);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout;
  }
}
