import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";

/** 履歴を出す worktree */
export interface Target {
  path: string;
  /** workspace（リポジトリ）の名前 */
  workspace: string;
  /** worktree の表示名（ブランチ名。無ければフォルダー名） */
  label: string;
  branch: string | null;
}

/**
 * tmux で今いるペインがある worktree を返す。
 * 今いるペインは、worktree 直下のペイン（tmux.panes[].current）か会話ペイン（agents[].tmux.current）で判定する。
 * どの worktree にも今いるペインが無いときは、前回の値（previous）のまま変えない。
 */
export function resolveTarget(list: ListedTree, previous: Target | null): Target | null {
  for (const ws of list.workspaces) {
    for (const wt of ws.worktrees) {
      if (wt.tmux.panes.some((p) => p.current) || wt.agents.some((a) => a.tmux.current)) {
        return { path: wt.path, workspace: ws.name, label: worktreeDisplayName(wt), branch: wt.branch };
      }
    }
  }
  return previous;
}
