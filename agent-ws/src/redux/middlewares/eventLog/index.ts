/**
 * eventLog middleware: エージェントの出来事をログに記録し、ログから流し直す
 *
 * - 記録: エージェントの出来事と確認（acknowledged）のうち、状態を変えたものだけを追記する。agentEnded ならログごと消す
 * - 流し直し: agentsRequested でログを読み、記録済みの目印（replayed）を付けて dispatch する。
 *   同じ出来事に agents と attention の両方の reducer が反応する
 * - 見張り: followStarted でログのディレクトリを見張り、他のプロセスが書いた分を取り込む
 *
 * createStore の log として、reducer の直前に組む（他の middleware が途中で出した出来事より先に記録するため）
 */
import { isAnyOf } from "@reduxjs/toolkit";
import type { AppMiddleware, RootState } from "../../createStore.ts";
import {
  agentEnded,
  agentForgotten,
  agentRestored,
  agentsRequested,
  followStarted,
  isAgentEvent,
  logsChanged,
} from "../../modules/app/agents/slice.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { isReplayed, replayed } from "../../utils/replayed.ts";
import { defaultDir, openLog } from "./log.ts";

/** pid が分からないエージェントを、ログの更新が途絶えてから保持する期間 */
const TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降の出来事の数 */
const SNAPSHOT_EVERY = 200;

const isRecorded = isAnyOf(isAgentEvent, acknowledged);

/** 記録の単位: そのエージェントの状態と確認の状況（どちらかが変われば記録する） */
const recordOf = (st: RootState, id: string) => [st.app.agents.byId[id], st.app.attention[id]] as const;

export const eventLog =
  (o: { dir?: string } = {}): AppMiddleware =>
  (api) => {
    const log = openLog(o.dir ?? defaultDir());
    const offsets = new Map<string, number>(); // このプロセスが読み終えた位置。見張りでは差分だけ流す
    let stopWatching: (() => void) | undefined;

    const load = (id: string, mtimeMs: number) => {
      const r = log.read(id);
      if (!r) return;
      if (r.snapshot) api.dispatch(replayed(agentRestored(r.snapshot)));
      for (const e of r.events) api.dispatch(replayed(e));
      offsets.set(id, r.offset);
      const st = api.getState();
      const [agent, attention] = recordOf(st, id);
      if (agent && attention && r.events.length >= SNAPSHOT_EVERY) log.saveSnapshot(id, { agent, attention }, r.offset);
      // pid の分からないエージェントは、プロセスで生死を確かめられないので期限で閉じる
      const now = Date.now();
      if (agent && !agent.pid && now - mtimeMs > TTL) api.dispatch(agentEnded({ agentId: id, at: now }));
    };

    const follow = () => {
      const present = log.list();
      for (const { id, mtimeMs } of present) {
        const from = offsets.get(id);
        if (from === undefined) {
          load(id, mtimeMs);
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

    return (next) => (action) => {
      if (isRecorded(action) && !isReplayed(action)) {
        const id = action.payload.agentId;
        const [agent, attention] = recordOf(api.getState(), id);
        const result = next(action);
        const after = recordOf(api.getState(), id);
        if (agentEnded.match(action)) {
          log.remove(id);
          offsets.delete(id);
        } else if (after[0] !== agent || after[1] !== attention) {
          log.append(id, action);
        }
        return result;
      }
      const result = next(action);
      if (agentsRequested.match(action)) {
        const all = log.list();
        const wanted = action.payload?.ids;
        for (const l of wanted ? all.filter((x) => wanted.includes(x.id)) : all) load(l.id, l.mtimeMs);
      } else if (logsChanged.match(action)) {
        follow();
      } else if (followStarted.match(action) && !stopWatching) {
        let timer: Timer | undefined;
        stopWatching = log.watch(() => {
          clearTimeout(timer); // 連続した追記はまとめて取り込む
          timer = setTimeout(() => api.dispatch(logsChanged()), 50);
        });
      }
      return result;
    };
  };
