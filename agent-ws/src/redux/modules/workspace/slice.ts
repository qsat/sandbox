/**
 * ワークスペース: リポジトリ・worktree・プロセス・git の変更件数
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ProcInfo, Repository } from "../../../domain/model.ts";

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
