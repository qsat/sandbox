/**
 * eventLog middleware: エージェントの出来事をログに記録し、ログから流し直す
 *
 * - 記録: エージェントの出来事と確認（acknowledged）のうち、状態を変えたものだけを追記する。agentEnded ならログごと消す
 * - 流し直し: 起動したら（initialized）ログを読み、記録済みの目印（replayed）を付けて dispatch する。
 *   同じ出来事に agents と attention の両方の reducer が反応する
 * - 見張り: follow のとき、ログのディレクトリを見張って他のプロセスが書いた分を取り込む。時間が経ったら（ticked）取りこぼしも拾う
 *
 * createStore の log として、reducer の直前に組む（他の middleware が途中で出した出来事より先に記録するため）
 */
import { isAnyOf } from "@reduxjs/toolkit";
import { debounce } from "../../../lib/debounce.ts";
import type { AppMiddleware } from "../../createStore.ts";
import { agentEnded, agentForgotten, agentRestored, isLiveEvent } from "../../modules/app/agents/slice.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { Agent } from "../../types/agent.ts";
import { isReplayed, replayed } from "../../utils/replayed.ts";
import { effects, on } from "../effects.ts";
import { type LogRead, openLog } from "./log.ts";

/** pid が分からないエージェントを、ログの更新が途絶えてから保持する期間 */
const TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降の出来事の数 */
const SNAPSHOT_EVERY = 200;

/** ログに追記する出来事: エージェントが生きている間の出来事と、人の確認 */
const isAppended = isAnyOf(isLiveEvent, acknowledged);

/** pid の分からないエージェントは、プロセスで生死を確かめられないので、ログの更新が途絶えて期間が過ぎたら閉じる */
const expired = (agent: Agent, mtimeMs: number, at: number) => !agent.pid && at - mtimeMs > TTL;

/** 記録の単位: そのエージェントの状態と確認の状況（どちらかが変われば記録する） */
const recordOf = (st: RootState, id: string) => [st.app.agents.byId[id], st.app.attention[id]] as const;

export interface EventLogOptions {
  dir: string; // ログの置き場所
  follow?: boolean; // 他のプロセスが書いた分を取り込み続ける（watch）
}

export const eventLog = (o: EventLogOptions): AppMiddleware =>
  effects((api) => {
    const log = openLog(o.dir);
    const offsets = new Map<string, number>(); // このプロセスが読み終えた位置。見張りでは差分だけ流す

    /** 読んだ分を、記録済みの目印を付けて流す */
    const replay = (id: string, r: LogRead) => {
      if (r.snapshot) api.dispatch(replayed(agentRestored(r.snapshot)));
      for (const e of r.events) api.dispatch(replayed(e));
      offsets.set(id, r.offset);
    };

    /** 読み込んだ後の手入れ: 長くなったログはスナップショットを取り直し、pid の分からないエージェントは期限で閉じる */
    const tidy = (id: string, r: LogRead, mtimeMs: number, at: number) => {
      const [agent, attention] = recordOf(api.getState(), id);
      if (!agent || !attention) return;
      if (r.events.length >= SNAPSHOT_EVERY) log.saveSnapshot(id, { agent, attention }, r.offset);
      if (expired(agent, mtimeMs, at)) api.dispatch(agentEnded({ agentId: id, at }));
    };

    /** at: いまの時刻（期限切れの判断に使う） */
    const load = (id: string, mtimeMs: number, at: number) => {
      const r = log.read(id);
      if (!r) return;
      replay(id, r);
      tidy(id, r, mtimeMs, at);
    };

    /** まだ読んでいないログは全部、読んだログは続きだけ取り込む */
    const catchUp = (id: string, mtimeMs: number) => {
      const from = offsets.get(id);
      if (from === undefined) return load(id, mtimeMs, api.getState().app.lifecycle.now);
      const r = log.read(id, from);
      if (r?.events.length) replay(id, r);
    };

    const forget = (id: string) => {
      offsets.delete(id);
      api.dispatch(agentForgotten({ agentId: id }));
    };

    /** 他のプロセスが書いた分を取り込む。消えたログのエージェントは忘れる */
    const follow = () => {
      const present = log.list();
      for (const l of present) catchUp(l.id, l.mtimeMs);
      const ids = new Set(present.map((l) => l.id));
      for (const id of [...offsets.keys()].filter((id) => !ids.has(id))) forget(id);
    };
    const followSoon = debounce(follow, 50); // 連続した追記はまとめて取り込む

    return [
      // 状態を変えた出来事だけを記録する（流し直した出来事は記録済み）
      on(isAppended, (action, prev) => {
        if (isReplayed(action)) return;
        const id = action.payload.agentId;
        const [agent, attention] = recordOf(api.getState(), id);
        const [agentBefore, attentionBefore] = recordOf(prev, id);
        if (agent !== agentBefore || attention !== attentionBefore) log.append(id, action);
      }),
      // エージェントが終わったら、ログごと消す
      on(agentEnded, ({ payload: { agentId } }) => {
        log.remove(agentId);
        offsets.delete(agentId);
      }),
      on(initialized, ({ payload: { at } }) => {
        for (const l of log.list()) load(l.id, l.mtimeMs, at);
        if (o.follow) log.watch(followSoon);
      }),
      on(ticked, () => {
        if (o.follow) follow(); // 見張りが取りこぼしたときの保険
      }),
    ];
  });
