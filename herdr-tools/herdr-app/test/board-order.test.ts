import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { itemId, sidebarItems } from "@herdr-tools/tmux/sidebar-order";
import { boardRows, rowId } from "../src/agent-board/board";

const agent = (id: string, status: "working" | "idle" | "blocked") => ({
  id,
  name: id,
  status,
  resumable: false,
  alive: true,
  cwd: "/g/o/api",
  missingLocation: false,
  parent: null,
  tmux: { attached: false, panes: [], current: false },
});

const list = {
  usage: {},
  workspaces: [
    {
      path: "/g/o/api",
      name: "github.com/o/api",
      worktrees: [
        { path: "/g/o/api", branch: "main", exists: true, isMain: true, tmux: { session: null, panes: [{ paneId: "%1", command: "zsh", current: false }] }, agents: [agent("a", "idle"), agent("b", "blocked")] },
      ],
    },
    { path: "/g/o/web", name: "github.com/o/web", worktrees: [{ path: "/g/o/web", branch: "main", exists: true, isMain: true, tmux: { session: null, panes: [] }, agents: [agent("c", "working")] }] },
  ],
} as unknown as ListedTree;

describe("mod の行と ws step の並びが同じ", () => {
  const live = [{ address: "a", status: { state: "blocked", kind: null } }];
  for (const collapsed of [[], ["/g/o/api"], ["/g/o/web"]]) {
    test(`畳んだ workspace が ${JSON.stringify(collapsed)} のとき、boardRows と sidebarItems の行の id が同じ順`, () => {
      expect(boardRows(list, live, collapsed).map(rowId)).toEqual(sidebarItems(list, live, collapsed).map(itemId));
    });
  }
});
