/**
 * claude を起動するときに `ws new` へ渡す引数（agent-board の「＋ claude」と workspace-picker で共通。I/O なし）。
 * exec は各 mod の main.ts だけが呼ぶ。
 */

/** worktree で claude を起動し、agents ウィンドウの会話ペインへ移って Ghostty を前に出す引数 */
export function wsNewArgs(worktreePath: string) {
  return ["new", worktreePath, "--attach", "--from-app"];
}
