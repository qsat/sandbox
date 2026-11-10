/**
 * git: リポジトリと変更件数を調べる（listener）
 *
 * - repositories: ghq 管理下のリポジトリと worktree 構成を持つ。起動したとき・人が読み直しを頼んだとき・
 *   時間が経って前回から15秒以上たったとき（前回の時刻は状態にある）に取り直す
 * - dirtyCounts: 表示する worktree の変更件数を持つ。表示する worktree が変わったとき・時間が経ったときに数え直す
 */
import { createSelector, isAnyOf } from "@reduxjs/toolkit";
import { type AppApi, type AppListener, addAppListener } from "../../createStore.ts";
import { selectAgentProcesses } from "../../modules/app/agents/selector.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import { filterRepos, placeAgents } from "../../modules/app/workspace/selector.ts";
import { dirtyScanned, reposScanned } from "../../modules/app/workspace/slice.ts";
import { reloadPressed } from "../../modules/ui/watch/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { Filter, Repository } from "../../types/workspace.ts";
import { repoName } from "../../utils/repoName.ts";
import * as cli from "./git.ts";

/** リポジトリ構成を取り直す間隔（重いので時間が経つたびには取らない） */
const REPOS_EVERY = 15_000;

/** ghq 管理下のリポジトリ（フラット展開の worktree が ghq 配下にあっても重複させない） */
function scanRepoPaths(roots: string[], query?: string): Repository[] {
  const repos = cli
    .listRepoPaths(roots, query)
    .map((path) => cli.listWorktrees(path))
    .filter((worktrees) => worktrees.length)
    .map((worktrees) => ({ name: repoName(worktrees[0].path, roots), path: worktrees[0].path, worktrees }));
  // メイン worktree のパスで束ねて、最初に見つかったものを残す
  const byMain = Map.groupBy(repos, (r) => r.path);
  return [...byMain.values()].map(([first]) => first).sort((a, b) => a.name.localeCompare(b.name));
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

/** 起動したか、人が読み直しを頼んだ */
const isStartOrReload = isAnyOf(initialized, reloadPressed);

/** リポジトリ構成を前に取ってから時間が経った */
const isStale = (st: RootState, at: number) => {
  const { scannedAt } = st.app.workspace;
  return scannedAt === null || at - scannedAt >= REPOS_EVERY;
};

/**
 * ghq 管理下のリポジトリと worktree 構成を持つ。起動したとき・人が読み直しを頼んだとき・
 * 時間が経って前回から15秒以上たったとき（前回の時刻は状態にある）に取り直す
 */
export function repositories(o: { ghq: cli.Ghq; query?: string }): AppListener[] {
  const scan = (api: AppApi, at: number) => {
    const roots = cli.ghqRoots(o.ghq);
    api.dispatch(reposScanned({ roots, repos: scanRepoPaths(roots, o.query), at }));
  };
  return [
    addAppListener({ matcher: isStartOrReload, effect: (_, api) => scan(api, api.getState().app.lifecycle.now) }),
    addAppListener({
      predicate: (action, current): action is ReturnType<typeof ticked> => ticked.match(action) && isStale(current, action.payload.at),
      effect: ({ payload: { at } }, api) => scan(api, at),
    }),
  ];
}

/**
 * 表示する worktree の変更件数を持つ。表示する worktree（リポジトリ構成・エージェントの居場所から決まる）が変わったとき、
 * 時間が経ったとき（ファイルが変わっているかもしれない）に数え直す。
 * repositories より先に組む（時間が経ったときに数えてから構成を取り直し、構成が変わったらもう一度数える）
 */
export function dirtyCounts(o: { filter: Filter }): AppListener[] {
  const selectShown = shownWorktrees(o.filter);
  /** 数えた worktree（状態にある）が、いま表示する worktree と違う */
  const shownChanged = (st: RootState) => selectShown(st).join("\n") !== Object.keys(st.app.workspace.dirty).join("\n");
  const count = (api: AppApi) => {
    const shown = selectShown(api.getState());
    api.dispatch(dirtyScanned(Object.fromEntries(shown.map((p) => [p, cli.countDirty(p)]))));
  };
  return [
    addAppListener({ actionCreator: ticked, effect: (_, api) => count(api) }),
    addAppListener({ predicate: (_, current) => shownChanged(current), effect: (_, api) => count(api) }),
  ];
}
