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

/**
 * コミットを順に見ていくときの引数（commit-history の ctrl-j / ctrl-k）。コミット全体（commit が null なら未コミットの変更）を、
 * hunk のファイルツリーを出して開く（`--sidebar`）。Ghostty を前に出さない（`--no-focus`）ので、mod にフォーカスを残したまま続けてキーを押せる
 */
export function wsHunkBrowseArgs(root: string, commit: string | null) {
  return ["hunk", root, ...(commit ? ["--commit", commit] : []), "--sidebar", "--from-app", "--no-focus"];
}

/** その worktree の hunk ウィンドウを閉じる引数（commit-history の q）。Ghostty の tmux クライアントは、同じ tmux セッションの前にいたウィンドウへ戻る */
export function wsHunkCloseArgs(root: string) {
  return ["hunk", root, "--close"];
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

/** ブランチ間の差分を開く引数（`hunk diff <range>`。例: `origin/main...HEAD`） */
export function wsHunkRangeArgs(root: string, range: string) {
  return ["hunk", root, "--range", range, "--from-app"];
}

/** 作業ツリーと 1 つのリビジョンの差分を開く引数（`hunk diff <rev>`。未コミット・追跡されていないファイルも含む） */
export function wsHunkAgainstArgs(root: string, rev: string) {
  return ["hunk", root, "--against", rev, "--from-app"];
}
