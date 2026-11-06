import { BASE_REF_CANDIDATES } from "@herdr-tools/utils/base-ref-candidates";

/** 範囲に合わせた、比べる相手のブランチ（push 前なら上流のブランチ、ベースからならベースブランチ）。それ以外の範囲と、ベースが分からないときは null */
export function compareRef(range: string, baseRef: string | null = null) {
  if (range === "unpushed") return "@{upstream}";
  if (range === "base") return baseRef;
  return null;
}

/**
 * 未コミットの変更も含めたブランチの差分の起点（分かれた点のコミット）を求める引数。
 * 出てきたハッシュと作業ツリーを hunk diff <hash> で比べる（git diff --merge-base <ref> と同じ。hunk は - で始まる引数を受け付けないので先に求める）
 */
export function mergeBaseArgs(ref: string) {
  return ["merge-base", ref, "HEAD"];
}

/** `git symbolic-ref refs/remotes/origin/HEAD` の出力（refs/remotes/origin/main）から、表示と git に渡す名前（origin/main）を作る */
export function shortRef(ref: string) {
  return ref.trim().replace(/^refs\/(remotes|heads)\//, "");
}

/** ボタンに出すベースブランチの名前。リモートの名前（origin/）は外す */
export function branchLabel(ref: string) {
  return ref.replace(/^origin\//, "");
}

/**
 * プルリクエストの base ブランチ（`gh pr view --json baseRefName` の値）を、git log に渡す ref にする。
 * リモートのブランチ（origin/<base>）を先に、無ければ手元のブランチを使う。どちらも無ければ null
 */
export function prBaseRef(baseRefName: string, exists: (ref: string) => boolean) {
  const name = baseRefName.trim();
  if (!name) return null;
  if (exists(`refs/remotes/origin/${name}`)) return `origin/${name}`;
  if (exists(`refs/heads/${name}`)) return name;
  return null;
}

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
