import type { Context, View } from "gpui-kit";
import { home, watchFolder, writeTextFile } from "herdr";

/** tmux.conf の hook が触れるフォルダー（home からの相対）。変化を見張って、すぐ読み直す */
export const TMUX_FOCUS_DIR = ".cache/herdr-tools/tmux-focus";

/**
 * tmux の hook（tmux.conf）が今いるペイン・ウィンドウ・セッションの変化でフォルダーのファイルに触れたら、onChange を呼ぶ。
 * 見張りが失敗しても（フォルダーが作れない・見張れない）mod は壊さず、呼び出し側の定期の読み直しだけで動く
 */
export function watchTmuxFocus(cx: Context, owner: View, onChange: (cx: Context) => void) {
  cx.spawn(
    async (cx) => {
      const dir = `${home()}/${TMUX_FOCUS_DIR}`;
      try {
        // フォルダーが無いと見張りが失敗するかもしれないので、中にファイルを書いて作っておく（既にあれば書けないだけ）
        await writeTextFile(`${dir}/.keep`, "", null).catch(() => {});
        for (;;) {
          await watchFolder(dir);
          onChange(cx);
        }
      } catch {
        // 定期の読み直しがあるので、何もしない
      }
    },
    { owner },
  );
}
