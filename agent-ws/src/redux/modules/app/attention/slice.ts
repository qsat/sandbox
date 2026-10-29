/**
 * Attention: 人の対応が要るもの
 *
 * 許可待ち・質問待ち・エラーはエージェントのいまの状況から導けるので持たない（selector で求める）。
 * ここで持つのは導けないもの、つまり「ターンの完了を、人がまだ見ていない」こと。
 * エージェントの出来事と同じログに記録され、同じように流し直される。
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  agentAttached,
  agentEnded,
  agentForgotten,
  agentRestored,
  agentStarted,
  turnFinished,
  turnInterrupted,
  turnStarted,
} from "../agents/slice.ts";

/** エージェント ID → 確認の状況 */
export type AttentionState = Record<string, { unseen: boolean }>;

const set = (st: AttentionState, id: string, unseen: boolean) => {
  const r = st[id];
  if (r && r.unseen !== unseen) r.unseen = unseen;
};

export const attention = createSlice({
  name: "attention",
  initialState: {} as AttentionState,
  reducers: {
    /** 人がそのエージェントの結果を見た（ペインへのフォーカス・ポップアップからの移動・表示中のペインでの完了） */
    acknowledged: (st, { payload }: PayloadAction<{ agentId: string; at: number }>) => set(st, payload.agentId, false),
  },
  // エージェントの出来事に、確認の状況として反応する
  extraReducers: (b) => {
    b.addCase(agentAttached, (st, { payload }) => {
      st[payload.agentId] ??= { unseen: false };
    });
    b.addCase(agentRestored, (st, { payload }) => {
      st[payload.agent.id] = { ...payload.attention };
    });
    b.addCase(agentEnded, (st, { payload }) => {
      delete st[payload.agentId];
    });
    b.addCase(agentForgotten, (st, { payload }) => {
      delete st[payload.agentId];
    });
    // バックグラウンドのサブエージェントが残っていれば、本体が自動で再開するのでまだ完了ではない
    b.addCase(turnFinished, (st, { payload }) => set(st, payload.agentId, !payload.background));
    b.addCase(turnStarted, (st, { payload }) => set(st, payload.agentId, false));
    b.addCase(turnInterrupted, (st, { payload }) => set(st, payload.agentId, false));
    b.addCase(agentStarted, (st, { payload }) => {
      if (payload.source !== "compact") set(st, payload.agentId, false);
    });
  },
});
export const { acknowledged } = attention.actions;
