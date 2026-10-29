/**
 * tmux の出力の解析（純粋な関数。パスの実体化は tmux.ts が行う）
 */
import type { Pane } from "../../types/visit.ts";

// tmux は -F の出力中の制御文字（ロケールによっては非 ASCII も）を "_" に置き換えるので ASCII で区切る
const SEP = "|~|";

/** `tmux list-panes -a -F` に渡す書式 */
export const PANE_FORMAT = [
  "pane_id",
  "pane_pid",
  "session_name",
  "window_index",
  "window_name",
  "pane_current_path",
  "pane_active",
  "window_active",
  "session_attached",
]
  .map((f) => `#{${f}}`)
  .join(SEP);

/** PANE_FORMAT での list-panes の出力。表示中 = アクティブなウィンドウのアクティブなペインで、セッションにクライアントが接続している */
export const parsePanes = (out: string): Pane[] =>
  out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [id, pid, session, window, windowName, path, paneActive, windowActive, attached] = l.split(SEP);
      const active = paneActive === "1" && windowActive === "1" && attached !== "0";
      return { id, pid: Number(pid), session, window, windowName, path, active };
    });
