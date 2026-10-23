/**
 * アプリケーション層: ドメインのルールと外界（git / プロセス / 状態ファイル / tmux）をつなぐユースケース
 */
import type { Filter, HookEvent, JumpResult, JumpTarget, Notice, Pid, Repository, Session } from "./domain.ts";
import {
  ancestry, applyHook, attachProcesses, detectAgent, findPane, HOOK_EVENTS, linkSessions, repoName, selectRepos, SESSION_TTL, settleInterrupted, subagentExpired,
} from "./domain.ts";
import * as git from "./infra/git.ts";
import * as proc from "./infra/proc.ts";
import { realPath } from "./infra/shell.ts";
import * as store from "./infra/store.ts";
import * as tmux from "./infra/tmux.ts";
import { tailSince } from "./infra/transcript.ts";

/** ghq 管理下のリポジトリと worktree 構成（重いので watch ではキャッシュする） */
export function loadRepositories(roots: string[], query?: string): Repository[] {
  const byMain = new Map<string, Repository>(); // フラット展開の worktree が ghq 配下にあっても重複させない
  for (const path of git.listRepoPaths(roots, query)) {
    const worktrees = git.listWorktrees(path);
    const main = worktrees[0]?.path;
    if (main && !byMain.has(main)) byMain.set(main, { name: repoName(main, roots), path: main, worktrees });
  }
  return [...byMain.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 構成に、いまのプロセスとセッション状態を重ねて、表示対象に絞る */
export function snapshot(repos: Repository[], filter: Filter): Repository[] {
  const procs = linkSessions(proc.listProcesses().filter((p) => p.pid !== process.pid), loadSessions());
  return selectRepos(attachProcesses(repos, procs), filter).map((r) => ({
    ...r,
    worktrees: r.worktrees.map((w) => ({ ...w, dirty: w.bare || w.prunable ? null : git.countDirty(w.path) })),
  }));
}

/** 生きているセッション（プロセスが消えたもの・期限切れのサブエージェントは掃除する。中断されたものは入力待ちに戻す） */
export function loadSessions(now = Date.now()): Session[] {
  const sessions = store.listSessions().flatMap((s) => {
    const alive = s.pid ? proc.isAlive(s.pid) : now - s.updated < SESSION_TTL;
    if (!alive) store.removeSession(s.id);
    if (!alive) return [];
    const tail = s.transcript && (s.status === "running" || s.status === "waiting") ? tailSince(s.transcript, s.updated) : null;
    const settled = tail && settleInterrupted(s, tail, now);
    if (settled) store.putSession(settled);
    return [settled || s];
  });
  const subagents = store.listSubagents().filter((a) => {
    const keep = sessions.some((s) => s.id === a.sessionId) && !subagentExpired(a, now);
    if (!keep) store.removeSubagent(a);
    return keep;
  });
  return sessions.map((s) => ({
    ...s,
    subagents: subagents.filter((a) => a.sessionId === s.id).sort((a, b) => a.since - b.since),
  }));
}

/** hook イベントで状態を更新する。人の注意が要る遷移なら通知内容を返す */
export function handleHook(e: HookEvent, now = Date.now()): Notice | null {
  if (!e.session_id) return null;
  const prev = {
    session: store.getSession(e.session_id),
    subagent: e.agent_id ? store.getSubagent(e.session_id, e.agent_id) : null,
  };
  const out = applyHook({ ...e, cwd: e.cwd && realPath(e.cwd) }, prev, now);
  if (out.subagent) store.putSubagent(out.subagent);
  if (out.session === "delete") store.removeSession(e.session_id);
  if (!out.session || out.session === "delete") return null;

  const pid = out.session.pid ?? findAgentPid();
  // いま表示しているペインで完了したなら、もう見ている
  const unseen = out.session.unseen && !paneOf(pid)?.active;
  const session = { ...out.session, pid, unseen: unseen || undefined };
  store.putSession(session);
  if (prev.session?.status !== session.status || Boolean(prev.session?.unseen) !== Boolean(session.unseen)) tmux.refreshStatus();
  if (!out.notify) return null;
  const main = git.listWorktrees(session.cwd)[0]?.path;
  return { repo: main ? repoName(main, git.ghqRoots()) : session.cwd, branch: git.currentBranch(session.cwd), session };
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

/** そのプロセスが動いている tmux ペイン */
function paneOf(pid: Pid | null) {
  return pid ? findPane({ title: "", name: "", pid }, tmux.listPanes(), parentOf()) : undefined;
}

/** そのペインで完了したセッションを既読にする（tmux の pane-focus-in とポップアップからの移動で呼ぶ） */
export function markSeen(panePid: Pid): number {
  const unseen = store.listSessions().filter((s) => s.unseen && s.pid);
  if (!unseen.length) return 0; // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
  const up = parentOf();
  const seen = unseen.filter((s) => [...ancestry(s.pid ?? undefined, up)].includes(panePid));
  for (const s of seen) store.putSession({ ...s, unseen: undefined });
  if (seen.length) tmux.refreshStatus();
  return seen.length;
}

/** 行の指す先の tmux ペインへ移動。見つからず create なら新しいウィンドウを開く */
export function jump(t: JumpTarget, o: { create: boolean; dryRun?: boolean }): JumpResult {
  const pane = findPane(t, tmux.listPanes(), parentOf());
  if (pane && o.dryRun) return { kind: "found", pane };
  if (pane) {
    if (!tmux.focusPane(pane.id)) return { kind: "failed", title: t.title };
    markSeen(pane.pid);
    return { kind: "focused", pane };
  }
  if (!o.create || !t.path || o.dryRun) return { kind: "notFound", title: t.title };
  const id = tmux.newWindow(t.path, t.name);
  return id && tmux.focusPane(id) ? { kind: "created", path: t.path } : { kind: "failed", title: t.title };
}

/** ~/.claude/settings.json の hooks に足す設定（全イベント同じコマンド。何が起きたかは入力 JSON で判断） */
export function hooksConfig(script: string) {
  const hook = { type: "command", command: process.execPath, args: [script, "hook"], timeout: 10 };
  const entries = Object.entries(HOOK_EVENTS).map(([event, matcher]) => [event, [{ ...(matcher ? { matcher } : {}), hooks: [hook] }]]);
  return { hooks: Object.fromEntries(entries) };
}
