import { lines, realPath, run } from "../../../lib/run.ts";
import type { Pane } from "../../types/visit.ts";

// tmux は -F の出力中の制御文字（ロケールによっては非 ASCII も）を "_" に置き換えるので ASCII で区切る
const SEP = "|~|";
const FORMAT = [
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

export function listPanes(): Pane[] {
  return lines(run("tmux", ["list-panes", "-a", "-F", FORMAT])).map((l) => {
    const [id, pid, session, window, windowName, path, paneActive, windowActive, attached] = l.split(SEP);
    const active = paneActive === "1" && windowActive === "1" && attached !== "0";
    return { id, pid: Number(pid), session, window, windowName, path: realPath(path), active };
  });
}

/** ペイン ID だけでセッション・ウィンドウ・ペインをまとめて切り替えられる */
export const focusPane = (id: string) =>
  run("tmux", ["switch-client", "-t", id, ";", "select-window", "-t", id, ";", "select-pane", "-t", id]) !== null;

/** 新しいウィンドウを開いてそのペイン ID を返す */
export const newWindow = (path: string, name: string) =>
  run("tmux", ["new-window", "-P", "-F", "#{pane_id}", "-c", path, "-n", name])?.trim() || null;
