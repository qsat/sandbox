/**
 * system middleware: OS のプロセスと git を調べる
 *
 * - agentProcessesRequested: ps からエージェントのプロセスだけを拾う
 * - livenessCheckRequested: プロセスが消えたエージェントを終わらせる
 * - reposRequested: ghq 管理下のリポジトリと worktree 構成
 * - dirtyRequested: 表示する worktree の変更件数
 */
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgents } from "../../modules/app/agents/selector.ts";
import { agentEnded, agentProcessesRequested, agentProcessesScanned, livenessCheckRequested } from "../../modules/app/agents/slice.ts";
import { selectTree } from "../../modules/app/workspace/selector.ts";
import { dirtyRequested, dirtyScanned, reposRequested, reposScanned } from "../../modules/app/workspace/slice.ts";
import type { AgentProcess } from "../../types/agent.ts";
import type { Repository } from "../../types/workspace.ts";
import { detectAgent } from "../../utils/detectAgent.ts";
import { repoName } from "../../utils/repoName.ts";
import * as git from "./git.ts";
import * as proc from "./proc.ts";

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

export const system = (): AppMiddleware => (api) => (next) => (action) => {
  const result = next(action);
  if (agentProcessesRequested.match(action)) {
    api.dispatch(agentProcessesScanned(agentProcesses()));
  } else if (livenessCheckRequested.match(action)) {
    for (const a of selectAgents(api.getState())) {
      if (a.pid && !proc.isAlive(a.pid)) api.dispatch(agentEnded({ agentId: a.id, at: action.payload.at }));
    }
  } else if (reposRequested.match(action)) {
    const roots = git.ghqRoots();
    api.dispatch(reposScanned({ roots, repos: scanRepos(roots, action.payload.query) }));
  } else if (dirtyRequested.match(action)) {
    const shown = selectTree(api.getState(), action.payload.filter).flatMap((r) => r.worktrees);
    api.dispatch(
      dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))),
    );
  }
  return result;
};
