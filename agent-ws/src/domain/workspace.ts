/**
 * ワークスペース: リポジトリ・worktree・プロセス・git の変更件数
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 * セッションと合わせて「リポジトリ > worktree > プロセス」のツリーにするのは selector の役目。
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Proc, ProcInfo, Repository, Worktree } from "./model.ts";
import { detectAgent, isUnder } from "./model.ts";
import type { Session } from "./sessions.ts";

export interface WorkspaceState {
  repos: Repository[]; // worktree 構成（processes と dirty は空）
  processes: ProcInfo[];
  dirty: Record<string, number | null>; // worktree のパス → 変更ファイル数
}

const initialState: WorkspaceState = { repos: [], processes: [], dirty: {} };

export const workspace = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    reposScanned: (st, a: PayloadAction<Repository[]>) => void (st.repos = a.payload),
    processesScanned: (st, a: PayloadAction<ProcInfo[]>) => void (st.processes = a.payload),
    dirtyScanned: (st, a: PayloadAction<Record<string, number | null>>) => void (st.dirty = a.payload),
  },
});
export const { reposScanned, processesScanned, dirtyScanned } = workspace.actions;

// ---------------------------------------------------------------------
// ツリーの組み立て
// ---------------------------------------------------------------------
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

export interface Filter {
  all: boolean; // 何も動いていないリポジトリも出す
  agentsOnly: boolean; // エージェントのプロセスだけ（いない worktree は省く）
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

/** 表示するツリー: 構成 × プロセス × セッション × 変更件数 */
export function selectTree(ws: WorkspaceState, sessions: Session[], filter: Filter, selfPid: number): Repository[] {
  const procs = linkSessions(ws.processes.filter((p) => p.pid !== selfPid), sessions);
  return selectRepos(attachProcesses(ws.repos, procs), filter).map((r) => ({
    ...r,
    worktrees: r.worktrees.map((w) => ({ ...w, dirty: w.bare || w.prunable ? null : (ws.dirty[w.path] ?? null) })),
  }));
}
