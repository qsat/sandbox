import { realPath, run } from "../../../lib/run.ts";
import type { Pane } from "../../types/visit.ts";
import { PANE_FORMAT, parsePanes } from "./parse.ts";

export const listPanes = (): Pane[] =>
  parsePanes(run("tmux", ["list-panes", "-a", "-F", PANE_FORMAT]) ?? "").map((p) => ({ ...p, path: realPath(p.path) }));

/** ペイン ID だけでセッション・ウィンドウ・ペインをまとめて切り替えられる */
export const focusPane = (id: string) =>
  run("tmux", ["switch-client", "-t", id, ";", "select-window", "-t", id, ";", "select-pane", "-t", id]) !== null;

/** 新しいウィンドウを開いてそのペイン ID を返す */
export const newWindow = (path: string, name: string) =>
  run("tmux", ["new-window", "-P", "-F", "#{pane_id}", "-c", path, "-n", name])?.trim() || null;
