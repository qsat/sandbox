import type { Tree } from "@herdr-tools/ws-core/domain/tree";
import type { TmuxIndex } from "./tmux-index";

export function toListJson(tree: Tree, idx: TmuxIndex) {
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

export type ListedTree = ReturnType<typeof toListJson>;
export type ListedAgent = ListedTree["workspaces"][number]["worktrees"][number]["agents"][number];
