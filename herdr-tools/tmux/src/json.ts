// ws list --json の形: ws-core の木に、tmux の情報を tmux キーで添える。
// 型は withTmux から推論する。Herdr app の mod も ListedTree を読む（型だけを import し、実行時には ws を exec して受け取る）。

import type { Tree } from "@herdr-tools/ws-core/model";
import type { TmuxIndex } from "./model";

export function withTmux(tree: Tree, idx: TmuxIndex) {
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

export type ListedTree = ReturnType<typeof withTmux>;
export type ListedAgent = ListedTree["workspaces"][number]["worktrees"][number]["agents"][number];
