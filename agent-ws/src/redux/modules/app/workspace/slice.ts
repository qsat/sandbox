/**
 * ワークスペース: リポジトリ・worktree・git の変更件数（どこで作業しているか）
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 * どのエージェントがどの worktree にいるかは持たず、selector でエージェントと結びつける。
 */
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Filter, Repository } from "../../../types/workspace.ts";

export interface WorkspaceState {
  roots: string[]; // ghq のルート（リポジトリ名の基準）
  repos: Repository[]; // worktree 構成（agents と dirty は空）
  dirty: Record<string, number | null>; // worktree のパス → 変更ファイル数
}

export const workspace = createSlice({
  name: "workspace",
  initialState: { roots: [], repos: [], dirty: {} } as WorkspaceState,
  reducers: {
    reposScanned: (st, a: PayloadAction<{ roots: string[]; repos: Repository[] }>) => {
      st.roots = a.payload.roots;
      st.repos = a.payload.repos;
    },
    dirtyScanned: (st, a: PayloadAction<Record<string, number | null>>) => {
      st.dirty = a.payload;
    },
  },
});
export const { reposScanned, dirtyScanned } = workspace.actions;

// 意図（〜してほしい）。middleware がスキャンして、結果を上のアクションで戻す
export const reposRequested = createAction<{ query?: string }>("workspace/reposRequested");
/** 変更件数は表示する worktree だけ数える */
export const dirtyRequested = createAction<{ filter: Filter }>("workspace/dirtyRequested");
/** スキャンし続ける（watch）。変更件数は interval ごと、リポジトリ構成は15秒ごと */
export const scanStarted = createAction<{ query?: string; filter: Filter; intervalMs: number }>("workspace/scanStarted");
