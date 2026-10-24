/**
 * worktree とエージェントを結びつけて「リポジトリ > worktree > エージェント」のツリーにする
 */
import type { RootState } from "../../../createStore.ts";
import type { Agent, AgentProcess } from "../../../types/agent.ts";
import type { AgentAt, Filter, Repository, Worktree } from "../../../types/workspace.ts";
import { isUnder } from "../../../utils/isUnder.ts";
import { selectAgentProcesses, selectAgents } from "../agents/selector.ts";
import { selectUnseen } from "../attention/selector.ts";

export const selectRoots = (st: RootState) => st.app.workspace.roots;

/** プロセスに hook で分かった状況を結びつける（pid 優先、pid が分からない claude は cwd） */
export function linkAgents(processes: AgentProcess[], agents: Agent[], unseen: (id: string) => boolean): AgentAt[] {
  const byPid = new Map(agents.flatMap((a) => (a.pid ? [[a.pid, a] as const] : [])));
  return processes.map((p) => {
    const agent = byPid.get(p.pid) ?? (p.kind === "claude" ? agents.find((a) => !a.pid && a.cwd === p.cwd) : undefined) ?? null;
    return { process: p, agent, unseen: agent ? unseen(agent.id) : false };
  });
}

/** エージェントを cwd で worktree に割り当てる（ネストした worktree に備えて最長一致） */
export function placeAgents(repos: Repository[], agents: AgentAt[]): Repository[] {
  const wts = repos.flatMap((r) => r.worktrees.filter((w) => !w.bare)).sort((a, b) => b.path.length - a.path.length);
  const placed = new Map<Worktree, AgentAt[]>();
  for (const a of agents) {
    const w = wts.find((w) => isUnder(a.process.cwd, w.path));
    if (w) placed.set(w, [...(placed.get(w) ?? []), a]);
  }
  return repos.map((r) => ({ ...r, worktrees: r.worktrees.map((w) => ({ ...w, agents: placed.get(w) ?? [] })) }));
}

/** 既定は「追加 worktree があるか、エージェントがいる」リポジトリだけ */
export function filterRepos(repos: Repository[], f: Filter): Repository[] {
  return repos
    .map((r) => (f.agentsOnly ? { ...r, worktrees: r.worktrees.filter((w) => w.agents.length) } : r))
    .filter((r) => r.worktrees.length)
    .filter((r) => f.all || f.agentsOnly || r.worktrees.length > 1 || r.worktrees.some((w) => w.agents.length));
}

/** 表示するツリー: 構成 × エージェント × 変更件数 */
export function selectTree(st: RootState, filter: Filter): Repository[] {
  const ws = st.app.workspace;
  const agents = linkAgents(selectAgentProcesses(st), selectAgents(st), (id) => selectUnseen(st, id));
  return filterRepos(placeAgents(ws.repos, agents), filter).map((r) => ({
    ...r,
    worktrees: r.worktrees.map((w) => ({ ...w, dirty: w.bare || w.prunable ? null : (ws.dirty[w.path] ?? null) })),
  }));
}
