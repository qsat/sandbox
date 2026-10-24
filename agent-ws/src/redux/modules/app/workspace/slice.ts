/**
 * ワークスペース: リポジトリ・worktree・プロセス・git の変更件数
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Session } from "../sessions/slice.ts";

export type Pid = number;
export type AgentKind = "claude" | "codex" | "aider" | "gemini" | "cursor" | "copilot" | "opencode" | "amp";

export interface Repository {
  name: string; // ghq root からの相対（github.com/owner/repo）
  path: string; // メイン worktree
  worktrees: Worktree[];
}

export interface Worktree {
  path: string;
  branch: string | null; // detached なら null
  head: string;
  isMain: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: number | null; // 変更ファイル数（表示対象だけ数える）
  processes: Proc[];
}

/** OS から見えるプロセス */
export interface ProcInfo {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
  cwd: string | null; // 読めなければ null
}

/** worktree に属するプロセス。エージェントなら agent / session が付く */
export interface Proc extends ProcInfo {
  cwd: string;
  agent: AgentKind | null;
  session: Session | null;
}

export interface WorkspaceState {
  repos: Repository[]; // worktree 構成（processes と dirty は空）
  processes: ProcInfo[];
  dirty: Record<string, number | null>; // worktree のパス → 変更ファイル数
}

export interface Filter {
  all: boolean; // 何も動いていないリポジトリも出す
  agentsOnly: boolean; // エージェントのプロセスだけ（いない worktree は省く）
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

// 意図（〜してほしい）。listener がスキャンして、結果を上のアクションで戻す
export const reposRequested = createAction<{ roots: string[]; query?: string }>("workspace/reposRequested");
export const processesRequested = createAction("workspace/processesRequested");
/** 変更件数は表示する worktree だけ数える */
export const dirtyRequested = createAction<{ filter: Filter }>("workspace/dirtyRequested");
