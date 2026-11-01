// ws list --json の形: ws-core の木に、tmux の情報を tmux キーで添える。
// Herdr app の mod もこの型を読む（型だけを import し、実行時には ws を exec して受け取る）。

import type { AgentNode, Tree, WorktreeNode } from "@herdr-tools/ws-core/model";
import type { TmuxIndex } from "./model";

export type ListedAgent = AgentNode & { tmux: { attached: boolean; panes: string[] } };
export type ListedWorktree = WorktreeNode<ListedAgent> & { tmux: { session: { name: string; attached: boolean } | null } };
export type ListedTree = Tree<ListedWorktree>;

export function withTmux(tree: Tree, idx: TmuxIndex): ListedTree {
  return {
    workspaces: tree.workspaces.map((ws) => ({
      ...ws,
      worktrees: ws.worktrees.map((wt) => {
        const s = idx.sessionOf(wt.path);
        return {
          ...wt,
          tmux: { session: s ? { name: s.name, attached: s.attached } : null },
          agents: wt.agents.map((a) => ({ ...a, tmux: { attached: idx.isAttached(a.id), panes: idx.panesOf(a.id).map((p) => p.paneId) } })),
        };
      }),
    })),
  };
}
