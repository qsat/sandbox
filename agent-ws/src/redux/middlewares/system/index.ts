/**
 * system middleware: OS のプロセスと git を調べる。何を調べるかは entry がオプションで決める
 *
 * - 起動したとき・時間が経ったとき: プロセスが消えたエージェントを終わらせる
 * - processes: エージェントのプロセス一覧。エージェントが増えた（pid がまだ一覧に無い）・消えたときも取り直す
 * - repos: ghq 管理下のリポジトリと worktree 構成。起動したとき・15秒ごと・人が読み直しを頼んだとき
 * - dirty: 表示する worktree の変更件数。スキャンのたびに数える
 */
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgentProcesses, selectAgents } from "../../modules/app/agents/selector.ts";
import { agentAttached, agentEnded, agentForgotten, agentProcessesScanned } from "../../modules/app/agents/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import { selectTree } from "../../modules/app/workspace/selector.ts";
import { dirtyScanned, reposScanned } from "../../modules/app/workspace/slice.ts";
import { reloadPressed } from "../../modules/ui/watch/slice.ts";
import type { AgentProcess } from "../../types/agent.ts";
import type { Filter, Repository } from "../../types/workspace.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { repoName } from "../../utils/repoName.ts";
import * as git from "./git.ts";
import * as proc from "./proc.ts";

export interface SystemOptions {
  processes?: boolean; // エージェントのプロセス一覧を持つ
  repos?: { query?: string }; // リポジトリ構成を持つ（query で絞る）
  dirty?: Filter; // このフィルタで表示する worktree の変更件数を持つ
}

/** リポジトリ構成を取り直す間隔（重いので時間が経つたびには取らない） */
const REPOS_EVERY = 15_000;
/** SessionEnd はプロセスが終わる前に届くので、終わるのを待ってから取り直す */
const AFTER_END = 1_000;

/** ps に見えるエージェントのプロセス（自分自身は除く） */
function agentProcesses(): AgentProcess[] {
  return proc.listProcesses().flatMap((p) => {
    const kind = detectAgent(p.command);
    return kind && p.cwd && p.pid !== process.pid ? [{ pid: p.pid, kind, cwd: p.cwd }] : [];
  });
}

/** ghq 管理下のリポジトリ（フラット展開の worktree が ghq 配下にあっても重複させない） */
function scanRepos(roots: string[], query?: string): Repository[] {
  const byMain = new Map<string, Repository>();
  for (const path of git.listRepoPaths(roots, query)) {
    const worktrees = git.listWorktrees(path);
    const main = worktrees[0]?.path;
    if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
  }
  return [...byMain.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const system =
  (o: SystemOptions = {}): AppMiddleware =>
  (api) => {
    let reposAt = 0;
    let rescanQueued = false;

    const checkLiveness = (at: number) => {
      for (const a of selectAgents(api.getState())) {
        if (a.pid && !proc.isAlive(a.pid)) api.dispatch(agentEnded({ agentId: a.id, at }));
      }
    };
    const scanProcesses = () => o.processes && api.dispatch(agentProcessesScanned(agentProcesses()));
    const scanReposNow = () => {
      if (!o.repos) return;
      const roots = git.ghqRoots();
      api.dispatch(reposScanned({ roots, repos: scanRepos(roots, o.repos.query) }));
      reposAt = Date.now();
    };
    const countDirty = () => {
      if (!o.dirty) return;
      const shown = selectTree(api.getState(), o.dirty).flatMap((r) => r.worktrees);
      api.dispatch(
        dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))),
      );
    };
    /** 出来事が続けて届いても、取り直しは1回にまとめる */
    const rescanProcesses = (delayMs: number) => {
      if (!o.processes || rescanQueued) return;
      rescanQueued = true;
      setTimeout(() => {
        rescanQueued = false;
        scanProcesses();
      }, delayMs);
    };

    return (next) => (action) => {
      const result = next(action);
      if (initialized.match(action)) {
        checkLiveness(action.payload.at);
        scanProcesses();
        scanReposNow();
        countDirty();
      } else if (ticked.match(action)) {
        checkLiveness(action.payload.at);
        scanProcesses();
        if (Date.now() - reposAt > REPOS_EVERY) scanReposNow();
        countDirty();
      } else if (reloadPressed.match(action)) {
        scanReposNow();
        countDirty();
      } else if (agentForgotten.match(action)) {
        rescanProcesses(AFTER_END);
      } else if (agentAttached.match(action)) {
        const st = api.getState();
        const pid = st.app.agents.byId[action.payload.agentId]?.pid;
        if (pid && !selectAgentProcesses(st).some((p) => p.pid === pid)) rescanProcesses(0);
      }
      return result;
    };
  };
