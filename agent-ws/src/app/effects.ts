/**
 * 副作用: thunk（I/O を伴う手続き）と listener（アクションや状態の変化に反応する処理）
 * 外界（git / プロセス / ログ / tmux / 会話ログ）に触れるのはここだけ。結果はアクションとして Store に戻す
 */
import { createAction, type UnknownAction } from "@reduxjs/toolkit";
import type { JumpResult, JumpTarget, Pid, Repository } from "../domain/model.ts";
import { ancestry, detectAgent, findPane, repoName } from "../domain/model.ts";
import {
  allSessions, attached, ended, forgotten, interrupted, isBlocked, isSessionAction, logReplayed, noticeOf, seen, statusFlags, stopped,
} from "../domain/sessions.ts";
import type { Filter } from "../domain/workspace.ts";
import { dirtyScanned, processesScanned, reposScanned, selectTree } from "../domain/workspace.ts";
import * as eventLog from "../infra/eventLog.ts";
import * as git from "../infra/git.ts";
import * as proc from "../infra/proc.ts";
import { realPath } from "../infra/shell.ts";
import * as tmux from "../infra/tmux.ts";
import { tailSince } from "../infra/transcript.ts";
import { type HookInput, interruptedSince, toActions } from "./claude.ts";
import type { AppStartListening, AppThunk, RootState, StoreOptions } from "./store.ts";

/** pid が分からないセッションを、ログの更新が途絶えてから保持する期間 */
const SESSION_TTL = 24 * 60 * 60_000;
/** スナップショットを取り直す、スナップショット以降のアクション数 */
const SNAPSHOT_EVERY = 200;

const sessionsIn = (st: RootState) => allSessions(st.sessions);

// ---------------------------------------------------------------------
// セッション: ログの読み込み・掃除・hook
// ---------------------------------------------------------------------
/** このプロセスが読み終えたログの位置。watch では差分だけ流す */
const offsets = new Map<string, number>();

const loadLog = (id: string): AppThunk => (dispatch, getState) => {
  const r = eventLog.read(id);
  if (!r) return;
  dispatch(logReplayed({ sessionId: id, base: r.base, actions: r.actions }));
  offsets.set(id, r.offset);
  const s = getState().sessions[id];
  if (s && r.actions.length >= SNAPSHOT_EVERY) eventLog.saveSnapshot(id, s, r.offset);
};

/** ログからセッションを組み立てる（ids を省くと全セッション） */
export const loadSessions = (ids?: string[]): AppThunk => (dispatch) => {
  for (const id of ids ?? eventLog.list().map((l) => l.id)) dispatch(loadLog(id));
};

/** ログの変化を取り込む（他のプロセスが追記・削除した分だけ） */
export const followLogs = (): AppThunk => (dispatch) => {
  const present = new Set(eventLog.list().map((l) => l.id));
  for (const id of present) {
    const from = offsets.get(id);
    if (from === undefined) {
      dispatch(loadLog(id));
      continue;
    }
    const r = eventLog.read(id, from);
    if (!r?.actions.length) continue;
    dispatch(logReplayed({ sessionId: id, actions: r.actions }));
    offsets.set(id, r.offset);
  }
  for (const id of offsets.keys()) {
    if (present.has(id)) continue;
    offsets.delete(id);
    dispatch(forgotten({ sessionId: id }));
  }
};

/** プロセスが消えたセッションを閉じ、hook の届かない中断を拾う */
export const settleSessions = (now = Date.now()): AppThunk => (dispatch, getState) => {
  const touched = new Map(eventLog.list().map((l) => [l.id, l.mtimeMs]));
  for (const s of sessionsIn(getState())) {
    const alive = s.pid ? proc.isAlive(s.pid) : now - (touched.get(s.id) ?? 0) < SESSION_TTL;
    if (!alive) {
      dispatch(ended({ sessionId: s.id, at: now }));
      continue;
    }
    if (!s.transcript || (s.status !== "running" && !isBlocked(s.status))) continue;
    const tail = tailSince(s.transcript, s.since);
    if (tail && interruptedSince(tail, s.since)) dispatch(interrupted({ sessionId: s.id, at: now }));
  }
};

/** hook の入力をアクションにして流す。新しいセッションなら本体の pid を探して結びつける */
export const handleHook = (input: HookInput, now = Date.now()): AppThunk => (dispatch, getState) => {
  const actions = toActions(input, now);
  if (!actions.length) return;
  const id = input.session_id;
  dispatch(loadLog(id));
  const s = getState().sessions[id];
  const onlyEnd = actions.every((a) => ended.match(a));
  if (!onlyEnd && (!s?.pid || (input.transcript_path && !s.transcript))) {
    const cwd = input.cwd ? realPath(input.cwd) : (s?.cwd ?? "");
    dispatch(attached({ sessionId: id, at: now, pid: s?.pid ?? findAgentPid(), cwd, transcript: input.transcript_path }));
  }
  for (const a of actions) dispatch(a);
};

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

// ---------------------------------------------------------------------
// ワークスペースのスキャン
// ---------------------------------------------------------------------
/** ghq 管理下のリポジトリと worktree 構成（重いので watch では間隔を空ける） */
export const scanRepos = (roots: string[], query?: string): AppThunk => (dispatch) => {
  const byMain = new Map<string, Repository>(); // フラット展開の worktree が ghq 配下にあっても重複させない
  for (const path of git.listRepoPaths(roots, query)) {
    const worktrees = git.listWorktrees(path);
    const main = worktrees[0]?.path;
    if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
  }
  dispatch(reposScanned([...byMain.values()].sort((a, b) => a.name.localeCompare(b.name))));
};

export const scanProcesses = (): AppThunk => (dispatch) => dispatch(processesScanned(proc.listProcesses()));

/** 変更件数は表示する worktree だけ数える */
export const scanDirty = (filter: Filter): AppThunk => (dispatch, getState) => {
  const st = getState();
  const shown = selectTree(st.workspace, sessionsIn(st), filter, process.pid).flatMap((r) => r.worktrees);
  dispatch(dirtyScanned(Object.fromEntries(shown.filter((w) => !w.bare && !w.prunable).map((w) => [w.path, git.countDirty(w.path)]))));
};

// ---------------------------------------------------------------------
// tmux
// ---------------------------------------------------------------------
const parentOf = () => {
  const ppid = new Map(proc.psTable().map((p) => [p.pid, p.ppid]));
  return (pid: Pid) => ppid.get(pid);
};

/** そのペインで完了したセッションを既読にする（tmux の pane-focus-in とポップアップからの移動） */
export const markSeenInPane = (panePid: Pid, now = Date.now()): AppThunk => (dispatch, getState) => {
  const unseen = sessionsIn(getState()).filter((s) => s.unseen && s.pid);
  if (!unseen.length) return; // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
  const up = parentOf();
  for (const s of unseen) if ([...ancestry(s.pid, up)].includes(panePid)) dispatch(seen({ sessionId: s.id, at: now }));
};

/** 行の指す先の tmux ペインへ移動。見つからず create なら新しいウィンドウを開く */
export const jumpTo = (t: JumpTarget, o: { create: boolean; dryRun?: boolean }): AppThunk<JumpResult> => (dispatch) => {
  const pane = findPane(t, tmux.listPanes(), parentOf());
  if (pane && o.dryRun) return { kind: "found", pane };
  if (pane) {
    if (!tmux.focusPane(pane.id)) return { kind: "failed", title: t.title };
    dispatch(markSeenInPane(pane.pid));
    return { kind: "focused", pane };
  }
  if (!o.create || !t.path || o.dryRun) return { kind: "notFound", title: t.title };
  const id = tmux.newWindow(t.path, t.name);
  return id && tmux.focusPane(id) ? { kind: "created", path: t.path } : { kind: "failed", title: t.title };
};

// ---------------------------------------------------------------------
// listener
// ---------------------------------------------------------------------
/** watch の常駐を始める。プロセス・変更件数は interval ごと、リポジトリ構成は15秒ごと、ログは変化したときに取り込む */
export const watchStarted = createAction<{ roots: string[]; query?: string; filter: Filter; intervalMs: number }>("app/watchStarted");

export function registerListeners(startListening: AppStartListening, o: StoreOptions): void {
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

  startListening({
    actionCreator: watchStarted,
    effect: async ({ payload: p }, api) => {
      let timer: Timer | undefined;
      const stop = eventLog.watch(() => {
        clearTimeout(timer); // 連続した追記はまとめて取り込む
        timer = setTimeout(() => api.dispatch(followLogs()), 50);
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
          api.dispatch(scanProcesses());
        }
      });
      try {
        for (let reposAt = 0; ; await api.delay(p.intervalMs)) {
          if (Date.now() - reposAt > 15_000) {
            api.dispatch(scanRepos(p.roots, p.query));
            reposAt = Date.now();
          }
          api.dispatch(followLogs());
          api.dispatch(settleSessions());
          api.dispatch(scanProcesses());
          api.dispatch(scanDirty(p.filter));
        }
      } finally {
        stop();
      }
    },
  });
}
