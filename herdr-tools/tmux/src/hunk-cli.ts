import { run } from "@herdr-tools/utils/run";
import { runOk } from "@herdr-tools/utils/run-ok";

/** hunk（ターミナルの差分ビューア）の daemon への問い合わせ。hunk のセッションは `--repo <worktree>` で指す */
export class HunkCli {
  constructor(readonly bin = "hunk") {}

  /** その worktree で開いている hunk のセッションが daemon に登録されているか */
  async hasSession(repo: string) {
    return (await run(this.bin, ["session", "get", "--repo", repo, "--json"])).code === 0;
  }

  async reload(repo: string, args: string[]) {
    await runOk(this.bin, ["session", "reload", "--repo", repo, "--", ...args]);
  }

  /** ファイルの最初の hunk へ移る。セッションがまだ現れないときは attempts 回まで間をあけて試す */
  async navigate(repo: string, file: string, attempts: number, intervalMs = 300) {
    let last = "";
    for (let i = 0; i < attempts; i++) {
      const r = await run(this.bin, ["session", "navigate", "--repo", repo, "--file", file, "--hunk", "1"]);
      if (r.code === 0) return;
      last = r.stderr.trim() || r.stdout.trim();
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`hunk session navigate: ${last}`);
  }
}
