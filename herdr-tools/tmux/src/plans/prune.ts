import type { Tree } from "@herdr-tools/ws-core";
import type { TmuxIndex } from "../tmux-index";

export function sessionsOfMissingWorktrees(tree: Tree, idx: TmuxIndex) {
  return tree.workspaces
    .flatMap((ws) => ws.worktrees)
    .flatMap((wt) => {
      const s = wt.exists ? undefined : idx.sessionOf(wt.path);
      return s ? [s.name] : [];
    });
}
