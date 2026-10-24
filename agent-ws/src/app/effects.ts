/**
 * 副作用は listener だけで扱う（thunk は使わない）
 *   意図（intents.ts）に反応して外界（git / プロセス / ログ / tmux / 会話ログ）に触れ、結果を事実のアクションとして戻す。
 *   事実のアクションや状態の変化に反応するもの（通知・ステータスラインの再描画など）もここに置く。
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import type { JumpResult, Pid, Repository } from "../domain/model.ts";
import { ancestry, detectAgent, findPane, repoName } from "../domain/model.ts";
import { jumped } from "../domain/navigation.ts";
import {
  allSessions, attached, ended, forgotten, interrupted, isBlocked, isSessionAction, logReplayed, noticeOf, seen, statusFlags, stopped,
} from "../domain/sessions.ts";
import { dirtyScanned, processesScanned, reposScanned, selectTree } from "../domain/workspace.ts";
import * as eventLog from "../infra/eventLog.ts";
import * as git from "../infra/git.ts";
import * as proc from "../infra/proc.ts";
import { realPath } from "../infra/shell.ts";
import * as tmux from "../infra/tmux.ts";
import { tailSince } from "../infra/transcript.ts";
import { interruptedSince, toActions } from "./claude.ts";
import {
  dirtyRequested, hookReceived, jumpRequested, logsChanged, processesRequested, reposRequested, seenInPaneRequested, sessionsRequested,
  settleRequested, watchStarted,
} from "./intents.ts";
import type { AppDispatch, AppStartListening, RootState, StoreOptions } from "./store.ts";

/** pid が分からないセッションを、ログの更新が途絶えてから保持する期間 */
const SESSION_TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降のアクション数 */
const SNAPSHOT_EVERY = 200;

const sessionsIn = (st: RootState) => allSessions(st.sessions);

/** このプロセスが読み終えたログの位置。watch では差分だけ流す */
const offsets = new Map<string, number>();

/** ログを読んで流す（スナップショットがあればその続きから） */
function replayLog(id: string, dispatch: AppDispatch, getState: () => RootState): void {
  const r = eventLog.read(id);
  if (!r) return;
  dispatch(logReplayed({ sessionId: id, base: r.base, actions: r.actions }));
  offsets.set(id, r.offset);
  const s = getState().sessions[id];
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

export function registerListeners(startListening: AppStartListening, o: StoreOptions): void {
  // ---------------------------------------------------------------------
  // セッション: ログの読み込み・掃除・hook
  // ---------------------------------------------------------------------
  startListening({
    actionCreator: sessionsRequested,
    effect: ({ payload }, api) => {
      for (const id of payload?.ids ?? eventLog.list().map((l) => l.id)) replayLog(id, api.dispatch, api.getState);
    },
  });

  startListening({
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
  });

  startListening({
    actionCreator: settleRequested,
    effect: ({ payload: { at } }, api) => {
      const touched = new Map(eventLog.list().map((l) => [l.id, l.mtimeMs]));
      for (const s of sessionsIn(api.getState())) {
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
  });

  // hook の入力をアクションにして流す。新しいセッションなら本体の pid を探して結びつける
  startListening({
    actionCreator: hookReceived,
    effect: ({ payload: { input, at } }, api) => {
      const actions = toActions(input, at);
      if (!actions.length) return;
      const id = input.session_id;
      replayLog(id, api.dispatch, api.getState);
      const s = api.getState().sessions[id];
      const onlyEnd = actions.every((a) => ended.match(a));
      if (!onlyEnd && (!s?.pid || (input.transcript_path && !s.transcript))) {
        const cwd = input.cwd ? realPath(input.cwd) : (s?.cwd ?? "");
        api.dispatch(attached({ sessionId: id, at, pid: s?.pid ?? findAgentPid(), cwd, transcript: input.transcript_path }));
      }
      for (const a of actions) api.dispatch(a);
    },
  });

  // ---------------------------------------------------------------------
  // ワークスペースのスキャン
  // ---------------------------------------------------------------------
  // ghq 管理下のリポジトリと worktree 構成（重いので watch では間隔を空ける）
  startListening({
    actionCreator: reposRequested,
    effect: ({ payload: { roots, query } }, api) => {
      const byMain = new Map<string, Repository>(); // フラット展開の worktree が ghq 配下にあっても重複させない
      for (const path of git.listRepoPaths(roots, query)) {
        const worktrees = git.listWorktrees(path);
        const main = worktrees[0]?.path;
        if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
      }
      api.dispatch(reposScanned([...byMain.values()].sort((a, b) => a.name.localeCompare(b.name))));
    },
  });

  startListening({
    actionCreator: processesRequested,
    effect: (_, api) => void api.dispatch(processesScanned(proc.listProcesses())),
  });

  startListening({
    actionCreator: dirtyRequested,
    effect: ({ payload: { filter } }, api) => {
      const st = api.getState();
      const shown = selectTree(st.workspace, sessionsIn(st), filter, process.pid).flatMap((r) => r.worktrees);
      api.dispatch(dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))));
    },
  });

  // ---------------------------------------------------------------------
  // tmux
  // ---------------------------------------------------------------------
  startListening({
    actionCreator: seenInPaneRequested,
    effect: ({ payload: { panePid, at } }, api) => {
      const unseen = sessionsIn(api.getState()).filter((s) => s.unseen && s.pid);
      if (!unseen.length) return; // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
      const up = parentOf();
      for (const s of unseen) if ([...ancestry(s.pid, up)].includes(panePid)) api.dispatch(seen({ sessionId: s.id, at }));
    },
  });

  startListening({
    actionCreator: jumpRequested,
    effect: ({ payload: { target: t, create, dryRun } }, api) => {
      const go = (): JumpResult => {
        const pane = findPane(t, tmux.listPanes(), parentOf());
        if (pane && dryRun) return { kind: "found", pane };
        if (pane) {
          if (!tmux.focusPane(pane.id)) return { kind: "failed", title: t.title };
          api.dispatch(seenInPaneRequested({ panePid: pane.pid, at: Date.now() }));
          return { kind: "focused", pane };
        }
        if (!create || !t.path || dryRun) return { kind: "notFound", title: t.title };
        const id = tmux.newWindow(t.path, t.name);
        return id && tmux.focusPane(id) ? { kind: "created", path: t.path } : { kind: "failed", title: t.title };
      };
      api.dispatch(jumped(go()));
    },
  });

  // ---------------------------------------------------------------------
  // 事実・状態の変化への反応
  // ---------------------------------------------------------------------
  // 人の注意が要る遷移を通知する（ログの流し直しでは通知しない。書いたプロセスが通知済み）
  startListening({
    predicate: isSessionAction,
    effect: (action, api) => {
      if (!o.onNotice || !isSessionAction(action)) return;
      const id = action.payload.sessionId;
      const n = noticeOf(api.getOriginalState().sessions[id], api.getState().sessions[id]);
      const s = api.getState().sessions[id];
      if (!n || !s) return;
      const main = git.listWorktrees(s.cwd)[0]?.path;
      o.onNotice({ repo: main ? repoName(main, git.ghqRoots()) : s.cwd, branch: git.currentBranch(s.cwd), ...n });
    },
  });

  // いま表示しているペインで完了したなら、もう見ている
  startListening({
    actionCreator: stopped,
    effect: (action, api) => {
      const s = api.getState().sessions[action.payload.sessionId];
      if (!s?.unseen || !s.pid) return;
      const pane = findPane({ title: "", name: "", pid: s.pid }, tmux.listPanes(), parentOf());
      if (pane?.active) api.dispatch(seen({ sessionId: s.id, at: action.payload.at }));
    },
  });

  // ステータスラインの印が変わったら、status-interval を待たずに描き直す
  const flags = (st: RootState) => JSON.stringify(statusFlags(sessionsIn(st)));
  startListening({
    predicate: (action, cur, prev) => isSessionAction(action) && flags(cur) !== flags(prev),
    effect: () => tmux.refreshStatus(),
  });

  // ---------------------------------------------------------------------
  // watch の常駐
  // ---------------------------------------------------------------------
  startListening({
    actionCreator: watchStarted,
    effect: async ({ payload: p }, api) => {
      let timer: Timer | undefined;
      const stop = eventLog.watch(() => {
        clearTimeout(timer); // 連続した追記はまとめて取り込む
        timer = setTimeout(() => api.dispatch(logsChanged()), 50);
      });
      // セッションが増えた（pid がまだプロセス一覧に無い）・消えたら、interval を待たずにプロセスを取り直す
      const needsRescan = (a: UnknownAction, st: RootState) =>
        forgotten.match(a) ||
        (logReplayed.match(a) && sessionsIn(st).some((s) => s.pid && !st.workspace.processes.some((p) => p.pid === s.pid)));
      api.fork(async (f) => {
        for (;;) {
          const [action] = await f.pause(api.take(needsRescan));
          // SessionEnd はプロセスが終わる前に届くので、終わるのを少し待つ
          if (forgotten.match(action)) await f.delay(1000);
          api.dispatch(processesRequested());
        }
      });
      try {
        for (let reposAt = 0; ; await api.delay(p.intervalMs)) {
          if (Date.now() - reposAt > 15_000) {
            api.dispatch(reposRequested({ roots: p.roots, query: p.query }));
            reposAt = Date.now();
          }
          api.dispatch(logsChanged());
          api.dispatch(settleRequested({ at: Date.now() }));
          api.dispatch(processesRequested());
          api.dispatch(dirtyRequested({ filter: p.filter }));
        }
      } finally {
        stop();
      }
    },
  });
}
