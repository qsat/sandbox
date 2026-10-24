/**
 * ワークスペースのスキャン（git・プロセス）
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import { type AppListener, addAppListener, type RootState } from "../../../createStore.ts";
import * as git from "../../../infra/git.ts";
import * as proc from "../../../infra/proc.ts";
import type { Repository } from "../../../types/workspace.ts";
import { repoName } from "../../../utils/repoName.ts";
import { selectSessions } from "../sessions/selector.ts";
import { forgotten, logReplayed } from "../sessions/slice.ts";
import { selectTree } from "./selector.ts";
import { dirtyRequested, dirtyScanned, processesRequested, processesScanned, reposRequested, reposScanned, scanStarted } from "./slice.ts";

/** セッションが増えた（pid がまだプロセス一覧に無い）・消えたら、interval を待たずにプロセスを取り直す */
const needsRescan = (a: UnknownAction, st: RootState) =>
  forgotten.match(a) ||
  (logReplayed.match(a) && selectSessions(st).some((s) => s.pid && !st.app.workspace.processes.some((p) => p.pid === s.pid)));

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
      api.dispatch(
        dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))),
      );
    },
  }),

  addAppListener({
    actionCreator: scanStarted,
    effect: async ({ payload: p }, api) => {
      api.fork(async (f) => {
        for (;;) {
          const [action] = await f.pause(api.take(needsRescan));
          // SessionEnd はプロセスが終わる前に届くので、終わるのを少し待つ
          if (forgotten.match(action)) await f.delay(1000);
          api.dispatch(processesRequested());
        }
      });
      for (let reposAt = 0; ; await api.delay(p.intervalMs)) {
        if (Date.now() - reposAt > 15_000) {
          api.dispatch(reposRequested({ roots: p.roots, query: p.query }));
          reposAt = Date.now();
        }
        api.dispatch(processesRequested());
        api.dispatch(dirtyRequested({ filter: p.filter }));
      }
    },
  }),
];
