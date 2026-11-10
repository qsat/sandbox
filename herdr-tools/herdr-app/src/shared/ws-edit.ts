/**
 * ファイルを $EDITOR で開くときに `ws edit` へ渡す引数（worktree-changes から。I/O なし）。
 * exec は mod の main.ts だけが呼ぶ。file は worktree からの相対パス
 */
export function wsEditArgs(root: string, file: { path: string }) {
  return ["edit", root, "--file", file.path, "--from-app"];
}

/** 開けないファイルのときの理由（開ける場合は null）。削除されたファイル（D）は作業ツリーに無いので $EDITOR で開かない */
export function editBlockedReason(file: { status: string; path: string }) {
  return file.status === "D" ? `削除されたファイルは開けない: ${file.path}` : null;
}
