import { BASE_REF_CANDIDATES } from "@herdr-tools/utils/base-ref-candidates";
import { prBaseRef, shortRef } from "./git";

type Run = (args: string[]) => Promise<{ code: number; stdout: string }>;

/**
 * ベースブランチ（git log に渡す名前。origin/main など）。今のブランチのプルリクエストがあれば、その base ブランチを使う（gh pr view）。
 * プルリクエストが無い・gh が使えないときは、origin/HEAD が指すブランチ、無ければ手元の main、master の順。どれも無ければ null
 */
export async function findBaseRef(git: Run, gh: Run) {
  const pr = await gh(["pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"]).catch(() => null);
  const name = pr && pr.code === 0 ? pr.stdout.trim() : "";
  if (name) {
    const candidates = [`refs/remotes/origin/${name}`, `refs/heads/${name}`];
    const found = await Promise.all(candidates.map((ref) => git(["rev-parse", "--verify", "--quiet", ref])));
    const existing = new Set(candidates.filter((_, i) => found[i]!.code === 0));
    const ref = prBaseRef(name, (r) => existing.has(r));
    if (ref) return ref;
  }
  const remoteHead = await git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (remoteHead.code === 0 && remoteHead.stdout.trim()) return shortRef(remoteHead.stdout);
  for (const ref of BASE_REF_CANDIDATES.slice(1)) {
    if ((await git(["rev-parse", "--verify", "--quiet", ref])).code === 0) return shortRef(ref);
  }
  return null;
}
