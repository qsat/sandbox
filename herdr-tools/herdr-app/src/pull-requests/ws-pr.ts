/** プルリクエストのブランチの worktree を用意して、その tmux セッションへ移る `ws pr` の引数（I/O なし） */
export function wsPrArgs(root: string, prNumber: number) {
  return ["pr", String(prNumber), root, "--from-app"];
}
