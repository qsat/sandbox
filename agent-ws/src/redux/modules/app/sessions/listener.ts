/**
 * セッションの副作用: ログの読み込み・取り込み・掃除、hook の受け付け、既読化
 */
import { type AppDispatch, type AppListener, addAppListener, type RootState } from "../../../createStore.ts";
import * as eventLog from "../../../infra/eventLog.ts";
import * as proc from "../../../infra/proc.ts";
import { realPath } from "../../../infra/shell.ts";
import * as tmux from "../../../infra/tmux.ts";
import { tailSince } from "../../../infra/transcript.ts";
import type { Pid } from "../../../types/workspace.ts";
import { ancestry } from "../../../utils/ancestry.ts";
import { detectAgent } from "../../../utils/detectAgent.ts";
import { findPane } from "../../../utils/findPane.ts";
import { interruptedSince, toActions } from "./hook.ts";
import { selectSession, selectSessions } from "./selector.ts";
import {
  attached,
  ended,
  followStarted,
  forgotten,
  hookReceived,
  interrupted,
  isBlocked,
  logReplayed,
  logsChanged,
  seen,
  seenInPaneRequested,
  sessionsRequested,
  settleRequested,
  stopped,
} from "./slice.ts";

/** pid が分からないセッションを、ログの更新が途絶えてから保持する期間 */
const SESSION_TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降のアクション数 */
const SNAPSHOT_EVERY = 200;

/** このプロセスが読み終えたログの位置。watch では差分だけ流す */
const offsets = new Map<string, number>();

/** ログを読んで流す（スナップショットがあればその続きから） */
function replayLog(id: string, dispatch: AppDispatch, getState: () => RootState): void {
  const r = eventLog.read(id);
  if (!r) return;
  dispatch(logReplayed({ sessionId: id, base: r.base, actions: r.actions }));
  offsets.set(id, r.offset);
  const s = selectSession(getState(), id);
  if (s && r.actions.length >= SNAPSHOT_EVERY) eventLog.saveSnapshot(id, s, r.offset);
}

/** hook の祖先プロセスを辿って claude 本体の pid を探す */
function findAgentPid(): Pid | null {
  for (let pid = process.ppid, i = 0; pid > 1 && i < 6; i++) {
    const p = proc.inspect(pid);
    if (!p) break;
    if (detectAgent(p.command) === "claude") return pid;
    pid = p.ppid;
  }
  return null;
}

const parentOf = () => {
  const ppid = new Map(proc.psTable().map((p) => [p.pid, p.ppid]));
  return (pid: Pid) => ppid.get(pid);
};

export const sessionListeners = (): AppListener[] => [
  addAppListener({
    actionCreator: sessionsRequested,
    effect: ({ payload }, api) => {
      for (const id of payload?.ids ?? eventLog.list().map((l) => l.id)) replayLog(id, api.dispatch, api.getState);
    },
  }),

  addAppListener({
    actionCreator: logsChanged,
    effect: (_, api) => {
      const present = new Set(eventLog.list().map((l) => l.id));
      for (const id of present) {
        const from = offsets.get(id);
        if (from === undefined) {
          replayLog(id, api.dispatch, api.getState);
          continue;
        }
        const r = eventLog.read(id, from);
        if (!r?.actions.length) continue;
        api.dispatch(logReplayed({ sessionId: id, actions: r.actions }));
        offsets.set(id, r.offset);
      }
      for (const id of offsets.keys()) {
        if (present.has(id)) continue;
        offsets.delete(id);
        api.dispatch(forgotten({ sessionId: id }));
      }
    },
  }),

  addAppListener({
    actionCreator: settleRequested,
    effect: ({ payload: { at } }, api) => {
      const touched = new Map(eventLog.list().map((l) => [l.id, l.mtimeMs]));
      for (const s of selectSessions(api.getState())) {
        const alive = s.pid ? proc.isAlive(s.pid) : at - (touched.get(s.id) ?? 0) < SESSION_TTL;
        if (!alive) {
          api.dispatch(ended({ sessionId: s.id, at }));
          continue;
        }
        if (!s.transcript || (s.status !== "running" && !isBlocked(s.status))) continue;
        const tail = tailSince(s.transcript, s.since);
        if (tail && interruptedSince(tail, s.since)) api.dispatch(interrupted({ sessionId: s.id, at }));
      }
    },
  }),

  // hook の入力をアクションにして流す。新しいセッションなら本体の pid を探して結びつける
  addAppListener({
    actionCreator: hookReceived,
    effect: ({ payload: { input, at } }, api) => {
      const actions = toActions(input, at);
      if (!actions.length) return;
      const id = input.session_id;
      replayLog(id, api.dispatch, api.getState);
      const s = selectSession(api.getState(), id);
      const onlyEnd = actions.every((a) => ended.match(a));
      if (!onlyEnd && (!s?.pid || (input.transcript_path && !s.transcript))) {
        const cwd = input.cwd ? realPath(input.cwd) : (s?.cwd ?? "");
        api.dispatch(attached({ sessionId: id, at, pid: s?.pid ?? findAgentPid(), cwd, transcript: input.transcript_path }));
      }
      for (const a of actions) api.dispatch(a);
    },
  }),

  addAppListener({
    actionCreator: seenInPaneRequested,
    effect: ({ payload: { panePid, at } }, api) => {
      const unseen = selectSessions(api.getState()).filter((s) => s.unseen && s.pid);
      if (!unseen.length) return; // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
      const up = parentOf();
      for (const s of unseen) if ([...ancestry(s.pid, up)].includes(panePid)) api.dispatch(seen({ sessionId: s.id, at }));
    },
  }),

  // いま表示しているペインで完了したなら、もう見ている
  addAppListener({
    actionCreator: stopped,
    effect: (action, api) => {
      const s = selectSession(api.getState(), action.payload.sessionId);
      if (!s?.unseen || !s.pid) return;
      const pane = findPane({ title: "", name: "", pid: s.pid }, tmux.listPanes(), parentOf());
      if (pane?.active) api.dispatch(seen({ sessionId: s.id, at: action.payload.at }));
    },
  }),

  addAppListener({
    actionCreator: followStarted,
    effect: async ({ payload: { intervalMs } }, api) => {
      let timer: Timer | undefined;
      const stop = eventLog.watch(() => {
        clearTimeout(timer); // 連続した追記はまとめて取り込む
        timer = setTimeout(() => api.dispatch(logsChanged()), 50);
      });
      try {
        for (; ; await api.delay(intervalMs)) {
          api.dispatch(logsChanged()); // fs.watch が取りこぼしたときの保険
          api.dispatch(settleRequested({ at: Date.now() }));
        }
      } finally {
        stop();
      }
    },
  }),
];
