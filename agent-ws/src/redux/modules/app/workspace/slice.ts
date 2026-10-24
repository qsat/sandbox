/**
 * ワークスペース: リポジトリ・worktree・プロセス・git の変更件数
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Filter, ProcInfo, Repository } from "../../../types/workspace.ts";

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
    reposScanned: (st, a: PayloadAction<Repository[]>) => {
      st.repos = a.payload;
    },
    processesScanned: (st, a: PayloadAction<ProcInfo[]>) => {
      st.processes = a.payload;
    },
    dirtyScanned: (st, a: PayloadAction<Record<string, number | null>>) => {
      st.dirty = a.payload;
    },
  },
});
export const { reposScanned, processesScanned, dirtyScanned } = workspace.actions;

// 意図（〜してほしい）。listener がスキャンして、結果を上のアクションで戻す
export const reposRequested = createAction<{ roots: string[]; query?: string }>("workspace/reposRequested");
export const processesRequested = createAction("workspace/processesRequested");
/** 変更件数は表示する worktree だけ数える */
export const dirtyRequested = createAction<{ filter: Filter }>("workspace/dirtyRequested");
/** スキャンし続ける（watch）。プロセス・変更件数は interval ごと、リポジトリ構成は15秒ごと */
export const scanStarted = createAction<{ roots: string[]; query?: string; filter: Filter; intervalMs: number }>("workspace/scanStarted");
