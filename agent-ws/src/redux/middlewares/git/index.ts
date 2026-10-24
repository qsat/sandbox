/**
 * git middleware: リポジトリと変更件数を調べる
 *
 * - repos のとき: ghq 管理下のリポジトリと worktree 構成を持つ。起動したとき・人が読み直しを頼んだとき・
 *   時間が経って前回から15秒以上たったとき（前回の時刻は状態にある）に取り直す
 * - dirty のとき: 表示する worktree の変更件数を持つ。表示する worktree が変わったとき・時間が経ったときに数え直す
 */
import { createSelector } from "@reduxjs/toolkit";
import type { AppMiddleware, RootState } from "../../createStore.ts";
import { selectAgentProcesses } from "../../modules/app/agents/selector.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import { filterRepos, placeAgents } from "../../modules/app/workspace/selector.ts";
import { dirtyScanned, reposScanned } from "../../modules/app/workspace/slice.ts";
import { reloadPressed } from "../../modules/ui/watch/slice.ts";
import type { Filter, Repository } from "../../types/workspace.ts";
import { repoName } from "../../utils/repoName.ts";
import { always, effects, on } from "../effects.ts";
import * as cli from "./git.ts";

export interface GitOptions {
  repos?: { query?: string }; // リポジトリ構成を持つ（query で絞る）
  dirty?: Filter; // このフィルタで表示する worktree の変更件数を持つ
}

/** リポジトリ構成を取り直す間隔（重いので時間が経つたびには取らない） */
const REPOS_EVERY = 15_000;

/** ghq 管理下のリポジトリ（フラット展開の worktree が ghq 配下にあっても重複させない） */
function scanRepoPaths(roots: string[], query?: string): Repository[] {
  const byMain = new Map<string, Repository>();
  for (const path of cli.listRepoPaths(roots, query)) {
    const worktrees = cli.listWorktrees(path);
    const main = worktrees[0]?.path;
    if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
  }
  return [...byMain.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 表示する worktree（変更件数を数えるもの）。リポジトリ構成とエージェントの居場所から決まる */
const shownWorktrees = (filter: Filter) =>
  createSelector([(st: RootState) => st.app.workspace.repos, selectAgentProcesses], (repos, procs) => {
    const agents = procs.map((process) => ({ process, agent: null, unseen: false }));
    return filterRepos(placeAgents(repos, agents), filter)
      .flatMap((r) => r.worktrees)
      .filter((w) => !w.bare && !w.prunable)
      .map((w) => w.path);
  });

export const git = (o: GitOptions = {}): AppMiddleware =>
  effects((api) => {
    const selectShown = shownWorktrees(o.dirty ?? { all: false, agentsOnly: false });
    const now = () => api.getState().app.lifecycle.now;

    const scanRepos = (at: number) => {
      if (!o.repos) return;
      const roots = cli.ghqRoots();
      api.dispatch(reposScanned({ roots, repos: scanRepoPaths(roots, o.repos.query), at }));
    };
    const countDirty = (at: number) => {
      if (!o.dirty) return;
      const shown = selectShown(api.getState());
      api.dispatch(dirtyScanned({ dirty: Object.fromEntries(shown.map((p) => [p, cli.countDirty(p)])), at }));
    };
    /** 数えた worktree（状態にある）が、いま表示する worktree と違う */
    const shownChanged = () => {
      const st = api.getState();
      return selectShown(st).join("\n") !== Object.keys(st.app.workspace.dirty).join("\n");
    };

    return [
      on([initialized, reloadPressed], () => scanRepos(now())),
      on(ticked, ({ payload: { at } }) => {
        const { scannedAt } = api.getState().app.workspace;
        if (scannedAt === null || at - scannedAt >= REPOS_EVERY) scanRepos(at);
        // ファイルが変わっているかもしれないので数え直す（リポジトリ構成が変わって数え直していれば、もう数えてある）
        if (api.getState().app.workspace.countedAt !== at) countDirty(at);
      }),
      // 表示する worktree（リポジトリ構成・エージェントの居場所から決まる）が変わったら数え直す
      always(() => {
        if (o.dirty && shownChanged()) countDirty(now());
      }),
    ];
  });
