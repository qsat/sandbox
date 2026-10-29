/**
 * ワークスペース: リポジトリ・worktree・git の変更件数（どこで作業しているか）
 *
 * 外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。
 * どのエージェントがどの worktree にいるかは持たず、selector でエージェントと結びつける。
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Repository } from "../../../types/workspace.ts";

export interface WorkspaceState {
  roots: string[]; // ghq のルート（リポジトリ名の基準）
  repos: Repository[]; // worktree 構成（agents と dirty は空）
  dirty: Record<string, number | null>; // 数えた worktree のパス → 変更ファイル数
  scannedAt: number | null; // リポジトリ構成を最後に取った時刻
}

export const workspace = createSlice({
  name: "workspace",
  initialState: { roots: [], repos: [], dirty: {}, scannedAt: null } as WorkspaceState,
  reducers: {
    reposScanned: (st, a: PayloadAction<{ roots: string[]; repos: Repository[]; at: number }>) => {
      st.roots = a.payload.roots;
      st.repos = a.payload.repos;
      st.scannedAt = a.payload.at;
    },
    dirtyScanned: (st, a: PayloadAction<Record<string, number | null>>) => {
      st.dirty = a.payload;
    },
  },
});
export const { reposScanned, dirtyScanned } = workspace.actions;
