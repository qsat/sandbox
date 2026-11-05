/**
 * hunk で開くときに `ws hunk` へ渡す引数（commit-history と pull-requests で共通。I/O なし）。
 * exec は各 mod の main.ts だけが呼ぶ。
 */

/**
 * 手元の worktree の差分を開く引数。コミットなら `--commit <hash>`、未コミットの変更なら付けない。
 * ファイルの行から開くときは `--file <path>` でそのファイルへ移り、コミットのハッシュから開くときはファイルを指定しない
 */
export function wsHunkArgs(root: string, commit: string | null, file: { path: string } | null) {
  return ["hunk", root, ...(commit ? ["--commit", commit] : []), ...(file ? ["--file", file.path] : []), "--from-app"];
}

/** GitHub のプルリクエスト全体を開く引数（`hunk gh pr <番号>`） */
export function wsHunkPrArgs(root: string, prNumber: number) {
  return ["hunk", root, "--pr", String(prNumber), "--from-app"];
}

/** GitHub のコミットを開く引数（`hunk gh commit <sha>`。手元に無いコミット用） */
export function wsHunkGithubCommitArgs(root: string, sha: string) {
  return ["hunk", root, "--gh-commit", sha, "--from-app"];
}

/** プルリクエストの下のコミットを開く引数。手元にあれば `hunk show`、無ければ GitHub から取る */
export function wsHunkPrCommitArgs(root: string, sha: string, existsLocally: boolean) {
  return existsLocally ? wsHunkArgs(root, sha, null) : wsHunkGithubCommitArgs(root, sha);
}
