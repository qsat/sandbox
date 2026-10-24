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
import type { AppMiddleware, RootState } from "../../createStore.ts";
import { agentEnded, agentForgotten, agentRestored, isAgentEvent } from "../../modules/app/agents/slice.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { initialized, ticked } from "../../modules/app/lifecycle/slice.ts";
import { isReplayed, replayed } from "../../utils/replayed.ts";
import { effects, on } from "../effects.ts";
import { defaultDir, openLog } from "./log.ts";

/** pid が分からないエージェントを、ログの更新が途絶えてから保持する期間 */
const TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降の出来事の数 */
const SNAPSHOT_EVERY = 200;

const isRecorded = isAnyOf(isAgentEvent, acknowledged);

/** 記録の単位: そのエージェントの状態と確認の状況（どちらかが変われば記録する） */
const recordOf = (st: RootState, id: string) => [st.app.agents.byId[id], st.app.attention[id]] as const;

export interface EventLogOptions {
  dir?: string; // ログの置き場所（省くと defaultDir()）
  follow?: boolean; // 他のプロセスが書いた分を取り込み続ける（watch）
}

export const eventLog = (o: EventLogOptions = {}): AppMiddleware =>
  effects((api) => {
    const log = openLog(o.dir ?? defaultDir());
    const offsets = new Map<string, number>(); // このプロセスが読み終えた位置。見張りでは差分だけ流す
    let stopWatching: (() => void) | undefined;

    /** at: いまの時刻（期限切れの判断に使う） */
    const load = (id: string, mtimeMs: number, at: number) => {
      const r = log.read(id);
      if (!r) return;
      if (r.snapshot) api.dispatch(replayed(agentRestored(r.snapshot)));
      for (const e of r.events) api.dispatch(replayed(e));
      offsets.set(id, r.offset);
      const st = api.getState();
      const [agent, attention] = recordOf(st, id);
      if (agent && attention && r.events.length >= SNAPSHOT_EVERY) log.saveSnapshot(id, { agent, attention }, r.offset);
      // pid の分からないエージェントは、プロセスで生死を確かめられないので期限で閉じる
      if (agent && !agent.pid && at - mtimeMs > TTL) api.dispatch(agentEnded({ agentId: id, at }));
    };

    const follow = () => {
      const present = log.list();
      for (const { id, mtimeMs } of present) {
        const from = offsets.get(id);
        if (from === undefined) {
          load(id, mtimeMs, api.getState().app.lifecycle.now);
          continue;
        }
        const r = log.read(id, from);
        if (!r?.events.length) continue;
        for (const e of r.events) api.dispatch(replayed(e));
        offsets.set(id, r.offset);
      }
      const ids = new Set(present.map((l) => l.id));
      for (const id of offsets.keys()) {
        if (ids.has(id)) continue;
        offsets.delete(id);
        api.dispatch(agentForgotten({ agentId: id }));
      }
    };

    return [
      // 状態を変えた出来事だけを記録する（流し直した出来事は記録済み）
      on(isRecorded, (action, prev) => {
        if (isReplayed(action)) return;
        const id = action.payload.agentId;
        if (agentEnded.match(action)) {
          log.remove(id);
          offsets.delete(id);
          return;
        }
        const [agent, attention] = recordOf(api.getState(), id);
        const [agentBefore, attentionBefore] = recordOf(prev, id);
        if (agent !== agentBefore || attention !== attentionBefore) log.append(id, action);
      }),
      on(initialized, ({ payload: { at } }) => {
        for (const l of log.list()) load(l.id, l.mtimeMs, at);
        if (!o.follow || stopWatching) return;
        let timer: Timer | undefined;
        stopWatching = log.watch(() => {
          clearTimeout(timer); // 連続した追記はまとめて取り込む
          timer = setTimeout(follow, 50);
        });
      }),
      on(ticked, () => {
        if (o.follow) follow(); // 見張りが取りこぼしたときの保険
      }),
    ];
  });
