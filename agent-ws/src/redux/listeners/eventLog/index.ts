/**
 * eventLog: エージェントの出来事をログに記録し、ログから流し直す（listener）
 *
 * - record: 状態を変えた出来事（エージェントの出来事と確認 acknowledged）だけを追記する。agentEnded ならログごと消す。
 *   起動したら（initialized）ログを読み、記録済みの目印（replayed）を付けて dispatch する（同じ出来事に agents と attention が反応する）
 * - follow: ログのディレクトリを見張って、他のプロセスが書いた分を取り込む。時間が経ったら（ticked）取りこぼしも拾う（watch で組む）
 *
 * record は createStore の log として、ほかの listener より先に登録する（ほかの listener が途中で出した出来事より先に記録するため）
 */
import { type ActionMatchingAnyOf, isAnyOf } from "@reduxjs/toolkit";
import { debounce } from "../../../lib/debounce.ts";
import { type AppListener, addAppListener, type AppApi as ListenerApi } from "../../createStore.ts";
import { agentEnded, agentForgotten, agentRestored, isLiveEvent } from "../../modules/app/agents/slice.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { Agent } from "../../types/agent.ts";
import { isFresh, replayed } from "../../utils/replayed.ts";
import { type LogRead, openLog } from "./log.ts";

/** pid が分からないエージェントを、ログの更新が途絶えてから保持する期間 */
const TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降の出来事の数 */
const SNAPSHOT_EVERY = 200;

/** ログに追記する出来事: エージェントが生きている間の出来事と、人の確認 */
const isAppended = isAnyOf(isLiveEvent, acknowledged);
type AppendedAction = ActionMatchingAnyOf<[typeof isLiveEvent, typeof acknowledged]>;

/** pid の分からないエージェントは、プロセスで生死を確かめられないので、ログの更新が途絶えて期間が過ぎたら閉じる */
const expired = (agent: Agent, mtimeMs: number, at: number) => !agent.pid && at - mtimeMs > TTL;

/** 記録の単位: そのエージェントの状態と確認の状況（どちらかが変われば記録する） */
const recordOf = (st: RootState, id: string) => [st.app.agents.byId[id], st.app.attention[id]] as const;

/** 状態を変えたか: その出来事のエージェントの状態か確認の状況が、前と違う */
const changed = (current: RootState, original: RootState, id: string) => {
  const [agent, attention] = recordOf(current, id);
  const [agentBefore, attentionBefore] = recordOf(original, id);
  return agent !== agentBefore || attention !== attentionBefore;
};

export interface EventLogOptions {
  dir: string; // ログの置き場所
}

export interface EventLog {
  record: AppListener[]; // 記録と起動時の読み込み
  follow: AppListener[]; // 他のプロセスが書いた分を取り込み続ける（watch）
}

export function eventLog(o: EventLogOptions): EventLog {
  const log = openLog(o.dir);
  const offsets = new Map<string, number>(); // このプロセスが読み終えた位置。見張りでは差分だけ流す

  /** 読んだ分を、記録済みの目印を付けて流す */
  const replay = (api: ListenerApi, id: string, r: LogRead) => {
    if (r.snapshot) api.dispatch(replayed(agentRestored(r.snapshot)));
    for (const e of r.events) api.dispatch(replayed(e));
    offsets.set(id, r.offset);
  };

  /** 読み込んだ後の手入れ: 長くなったログはスナップショットを取り直し、pid の分からないエージェントは期限で閉じる */
  const tidy = (api: ListenerApi, id: string, r: LogRead, mtimeMs: number, at: number) => {
    const [agent, attention] = recordOf(api.getState(), id);
    if (!agent || !attention) return;
    if (r.events.length >= SNAPSHOT_EVERY) log.saveSnapshot(id, { agent, attention }, r.offset);
    if (expired(agent, mtimeMs, at)) api.dispatch(agentEnded({ agentId: id, at }));
  };

  /** at: いまの時刻（期限切れの判断に使う） */
  const load = (api: ListenerApi, id: string, mtimeMs: number, at: number) => {
    const r = log.read(id);
    if (!r) return;
    replay(api, id, r);
    tidy(api, id, r, mtimeMs, at);
  };

  /** まだ読んでいないログは全部、読んだログは続きだけ取り込む */
  const catchUp = (api: ListenerApi, id: string, mtimeMs: number) => {
    const from = offsets.get(id);
    if (from === undefined) return load(api, id, mtimeMs, api.getState().app.lifecycle.now);
    const r = log.read(id, from);
    if (r?.events.length) replay(api, id, r);
  };

  /** 他のプロセスが書いた分を取り込む。消えたログのエージェントは忘れる */
  const follow = (api: ListenerApi) => {
    const present = log.list();
    for (const l of present) catchUp(api, l.id, l.mtimeMs);
    const ids = new Set(present.map((l) => l.id));
    for (const id of [...offsets.keys()].filter((id) => !ids.has(id))) {
      offsets.delete(id);
      api.dispatch(agentForgotten({ agentId: id }));
    }
  };

  return {
    record: [
      // 状態を変えた出来事だけを記録する（流し直した出来事は記録済み）
      addAppListener({
        predicate: (action, current, original): action is AppendedAction =>
          isAppended(action) && isFresh(action) && changed(current, original, action.payload.agentId),
        effect: (action) => log.append(action.payload.agentId, action),
      }),
      // エージェントが終わったら、ログごと消す
      addAppListener({
        actionCreator: agentEnded,
        effect: ({ payload: { agentId } }) => {
          log.remove(agentId);
          offsets.delete(agentId);
        },
      }),
      addAppListener({
        actionCreator: initialized,
        effect: ({ payload: { at } }, api) => {
          for (const l of log.list()) load(api, l.id, l.mtimeMs, at);
        },
      }),
    ],
    follow: [
      // 連続した追記はまとめて取り込む
      addAppListener({ actionCreator: initialized, effect: (_, api) => void log.watch(debounce(() => follow(api), 50)) }),
      // 見張りが取りこぼしたときの保険
      addAppListener({ actionCreator: ticked, effect: (_, api) => follow(api) }),
    ],
  };
}
