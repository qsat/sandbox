/**
 * ワークスペースのスキャン（git・プロセス）
 */
import type { Repository } from "./slice.ts";
import { repoName } from "../../../utils/repoName.ts";
import * as git from "../../../infra/git.ts";
import * as proc from "../../../infra/proc.ts";
import { addAppListener, type AppListener } from "../../../createStore.ts";
import { selectTree } from "./selector.ts";
import { dirtyRequested, dirtyScanned, processesRequested, processesScanned, reposRequested, reposScanned } from "./slice.ts";

export const workspaceListeners = (): AppListener[] => [
  // ghq 管理下のリポジトリと worktree 構成（重いので watch では間隔を空ける）
  addAppListener({
    actionCreator: reposRequested,
    effect: ({ payload: { roots, query } }, api) => {
      const byMain = new Map<string, Repository>(); // フラット展開の worktree が ghq 配下にあっても重複させない
      for (const path of git.listRepoPaths(roots, query)) {
        const worktrees = git.listWorktrees(path);
        const main = worktrees[0]?.path;
        if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
      }
      api.dispatch(reposScanned([...byMain.values()].sort((a, b) => a.name.localeCompare(b.name))));
    },
  }),

  addAppListener({
    actionCreator: processesRequested,
    effect: (_, api) => void api.dispatch(processesScanned(proc.listProcesses())),
  }),

  addAppListener({
    actionCreator: dirtyRequested,
    effect: ({ payload: { filter } }, api) => {
      const shown = selectTree(api.getState(), filter, process.pid).flatMap((r) => r.worktrees);
      api.dispatch(dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))));
    },
  }),
];
