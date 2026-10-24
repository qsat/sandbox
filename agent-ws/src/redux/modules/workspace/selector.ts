/**
 * セッションと合わせて「リポジトリ > worktree > プロセス」のツリーにする
 */
import type { Proc, ProcInfo, Repository, Worktree } from "../../../domain/model.ts";
import { detectAgent, isUnder } from "../../../domain/model.ts";
import type { RootState } from "../../createStore.ts";
import { selectSessions } from "../sessions/selector.ts";
import type { Session } from "../sessions/slice.ts";
import type { Filter } from "./slice.ts";

/** プロセスにエージェント種別とセッションを結びつける（pid 優先、不明なら cwd） */
export function linkSessions(infos: ProcInfo[], sessions: Session[]): Proc[] {
  const byPid = new Map(sessions.flatMap((s) => (s.pid ? [[s.pid, s] as const] : [])));
  return infos.flatMap((p) => {
    if (!p.cwd) return [];
    const agent = detectAgent(p.command);
    const session =
      byPid.get(p.pid) ?? (agent === "claude" ? sessions.find((s) => !s.pid && s.cwd === p.cwd) : undefined) ?? null;
    return [{ ...p, cwd: p.cwd, agent, session }];
  });
}

/** プロセスを cwd で worktree に割り当てる（ネストした worktree に備えて最長一致） */
export function attachProcesses(repos: Repository[], procs: Proc[]): Repository[] {
  const wts = repos.flatMap((r) => r.worktrees.filter((w) => !w.bare)).sort((a, b) => b.path.length - a.path.length);
  const owned = new Map<Worktree, Proc[]>();
  for (const p of procs) {
    const w = wts.find((w) => isUnder(p.cwd, w.path));
    if (w) owned.set(w, [...(owned.get(w) ?? []), p]);
  }
  return repos.map((r) => ({ ...r, worktrees: r.worktrees.map((w) => ({ ...w, processes: owned.get(w) ?? [] })) }));
}

/** 既定は「追加 worktree があるか、何か動いている」リポジトリだけ */
export function selectRepos(repos: Repository[], f: Filter): Repository[] {
  const onlyAgents = (r: Repository): Repository => ({
    ...r,
    worktrees: r.worktrees
      .map((w) => ({ ...w, processes: w.processes.filter((p) => p.agent) }))
      .filter((w) => w.processes.length),
  });
  return repos
    .map((r) => (f.agentsOnly ? onlyAgents(r) : r))
    .filter((r) => r.worktrees.length)
    .filter((r) => f.all || f.agentsOnly || r.worktrees.length > 1 || r.worktrees.some((w) => w.processes.length));
}

/** 表示するツリー: 構成 × プロセス × セッション × 変更件数（selfPid は自分自身を一覧から除くため） */
export function selectTree(st: RootState, filter: Filter, selfPid: number): Repository[] {
  const ws = st.workspace;
  const procs = linkSessions(ws.processes.filter((p) => p.pid !== selfPid), selectSessions(st));
  return selectRepos(attachProcesses(ws.repos, procs), filter).map((r) => ({
    ...r,
    worktrees: r.worktrees.map((w) => ({ ...w, dirty: w.bare || w.prunable ? null : (ws.dirty[w.path] ?? null) })),
  }));
}
