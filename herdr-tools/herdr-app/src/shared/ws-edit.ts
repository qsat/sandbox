/**
 * ファイルを $EDITOR で開くときに `ws edit` へ渡す引数（worktree-changes から。I/O なし）。
 * exec は mod の main.ts だけが呼ぶ。file は worktree からの相対パス
 */
export function wsEditArgs(root: string, file: { path: string }) {
  return ["edit", root, "--file", file.path, "--from-app"];
}
