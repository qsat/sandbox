/** エージェントや worktree の場所（tmux のペイン）へ行く */

import type { Pid } from "./agent.ts";

/** tmux のペイン */
export interface Pane {
  id: string; // %12
  pid: Pid; // ペインで最初に起動したプロセス（通常はシェル）
  session: string;
  window: string;
  windowName: string;
  path: string;
  active: boolean; // クライアントが接続しているセッションの、いま表示されているペイン
}

/** 行き先: pid（の祖先）がいるペイン、なければ path にいるペイン */
export interface VisitTarget {
  title: string;
  name: string; // 新しいウィンドウを開くときの名前
  pid?: Pid;
  path?: string;
}

export type VisitResult =
  | { kind: "focused" | "found"; pane: Pane } // found: dry-run
  | { kind: "created"; path: string }
  | { kind: "notFound" | "failed"; title: string };
