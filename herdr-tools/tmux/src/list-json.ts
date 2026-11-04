import type { Tree } from "@herdr-tools/ws-core/domain/tree";
import type { ClaudeUsage } from "@herdr-tools/ws-core/domain/usage";
import type { TmuxIndex } from "./tmux-index";

export function toListJson(tree: Tree, idx: TmuxIndex, usage: ClaudeUsage) {
  return {
    usage,
    workspaces: tree.workspaces.map((ws) => ({
      ...ws,
      worktrees: ws.worktrees.map((wt) => {
        const s = idx.sessionOf(wt.path);
        return {
          ...wt,
          tmux: { session: s ? { name: s.name, attached: s.attached } : null, panes: idx.otherPanesOf(wt.path).map((p) => ({ paneId: p.paneId, command: p.command })) },
          agents: wt.agents.map((a) => ({ ...a, tmux: { attached: idx.isAttached(a.id), panes: idx.panesOf(a.id).map((p) => p.paneId) } })),
        };
      }),
    })),
  };
}

export type ListedTree = ReturnType<typeof toListJson>;
export type ListedAgent = ListedTree["workspaces"][number]["worktrees"][number]["agents"][number];
