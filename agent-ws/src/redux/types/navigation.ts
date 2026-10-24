/** tmux のペインと、そこへの移動 */

import type { Pid } from "./workspace.ts";

/** tmux のペイン（エージェントが表示されている場所） */
export interface Pane {
  id: string; // %12
  pid: Pid; // ペインで最初に起動したプロセス（通常はシェル）
  session: string;
  window: string;
  windowName: string;
  path: string;
  active: boolean; // クライアントが接続しているセッションの、いま表示されているペイン
}

/** 移動先: pid（の祖先）がいるペイン、なければ path にいるペイン */
export interface JumpTarget {
  title: string;
  name: string; // 新しいウィンドウを開くときの名前
  pid?: Pid;
  path?: string;
}

export type JumpResult =
  | { kind: "focused" | "found"; pane: Pane } // found: dry-run
  | { kind: "created"; path: string }
  | { kind: "notFound" | "failed"; title: string };
