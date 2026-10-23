/**
 * ドメイン層: 型と純粋なルールだけを置く（I/O も表示もしない）
 *
 *   Repository ─< Worktree ─< Proc ── Session ─< Subagent
 *                                └─ 表示先 Pane（tmux）
 */

export type Pid = number;
export type AgentKind = "claude" | "codex" | "aider" | "gemini" | "cursor" | "copilot" | "opencode" | "amp";

/** ready: 入力待ち（起動直後・ターン完了） / waiting: 許可・質問への回答待ち */
export type SessionStatus = "ready" | "running" | "waiting" | "error";
export type SubagentStatus = "running" | "waiting" | "done";
export type Status = SessionStatus | SubagentStatus;

export interface Repository {
  name: string; // ghq root からの相対（github.com/owner/repo）
  path: string; // メイン worktree
  worktrees: Worktree[];
}

export interface Worktree {
  path: string;
  branch: string | null; // detached なら null
  head: string;
  isMain: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: number | null; // 変更ファイル数（表示対象だけ数える）
  processes: Proc[];
}

/** OS から見えるプロセス */
export interface ProcInfo {
  pid: Pid;
  ppid: Pid;
  elapsed: string;
  command: string;
  cwd: string | null; // 読めなければ null
}

/** worktree に属するプロセス。エージェントなら agent / session が付く */
export interface Proc extends ProcInfo {
  cwd: string;
  agent: AgentKind | null;
  session: Session | null;
}

/** エージェントのセッション（Claude Code の hook で分かる応答状況）。永続化される形 */
export interface SessionRecord {
  id: string;
  pid: Pid | null; // claude 本体
  cwd: string;
  status: SessionStatus;
  reason?: string; // 許可内容・最終応答の1行目など
  since: number; // この状態になった時刻
  updated: number;
}

export interface Session extends SessionRecord {
  subagents: Subagent[];
}

/** サブエージェントは本体プロセス内で動くので hook でのみ観測できる */
export interface Subagent {
  sessionId: string;
  id: string;
  type: string; // Explore, code-reviewer など
  status: SubagentStatus;
  detail?: string; // 実行中: 直近のツール / 許可待ち: 内容 / 完了: 最終応答の1行目
  since: number;
  updated: number;
}

/** tmux のペイン（エージェントが表示されている場所） */
export interface Pane {
  id: string; // %12
  pid: Pid; // ペインで最初に起動したプロセス（通常はシェル）
  session: string;
  window: string;
  windowName: string;
  path: string;
  active: boolean;
}

/** 移動先: pid（の祖先）がいるペイン、なければ path にいるペイン */
export interface JumpTarget {
  title: string;
  name: string; // 新しいウィンドウを開くときの名前
  pid?: Pid;
  path?: string;
}

export type JumpResult =
  | { kind: "focused" | "found"; pane: Pane } // found: dry-run
  | { kind: "created"; path: string }
  | { kind: "notFound" | "failed"; title: string };

/** 人の注意が要る遷移の通知内容 */
export interface Notice {
  repo: string;
  branch?: string;
  session: SessionRecord;
}

// ---------------------------------------------------------------------
// エージェント判定
// ---------------------------------------------------------------------
const AGENTS: [AgentKind, RegExp][] = [
  ["claude", /^claude$|@anthropic-ai\/claude-code|\/claude\/versions\//],
  ["codex", /^codex$|@openai\/codex/],
  ["aider", /^aider$/],
  ["gemini", /^gemini$|@google\/gemini-cli/],
  ["cursor", /^cursor-agent$/],
  ["copilot", /^copilot$|@github\/copilot/],
  ["opencode", /^opencode$/],
  ["amp", /^amp$|@sourcegraph\/amp/],
];
const RUNTIMES = /^(node|bun|deno|python3?(\.\d+)?|npx|uv|uvx)$/;
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 実行ファイル名で判定。node 等のランタイム経由ならスクリプトのパスで判定 */
export function detectAgent(command: string): AgentKind | null {
  const [exe = "", ...args] = command.split(/\s+/);
  const target = RUNTIMES.test(basename(exe)) ? (args.find((a) => !a.startsWith("-")) ?? "") : exe;
  return AGENTS.find(([, re]) => re.test(target) || re.test(basename(target)))?.[0] ?? null;
}

// ---------------------------------------------------------------------
// ツリーの組み立て
// ---------------------------------------------------------------------
export const isUnder = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

/** ghq root からの相対名（root の外なら絶対パスのまま） */
export function repoName(path: string, roots: string[]): string {
  const root = roots.find((r) => r !== path && isUnder(path, r));
  return root ? path.slice(root.length).replace(/^\//, "") : path;
}

/** プロセスにエージェント種別とセッションを結びつける（pid 優先、不明なら cwd） */
export function linkSessions(infos: ProcInfo[], sessions: Session[]): Proc[] {
  const byPid = new Map(sessions.flatMap((s) => (s.pid ? [[s.pid, s] as const] : [])));
  return infos.flatMap((p) => {
    if (!p.cwd) return [];
    const agent = detectAgent(p.command);
    const session =
      byPid.get(p.pid) ?? (agent === "claude" ? sessions.find((s) => !s.pid && s.cwd === p.cwd) : undefined) ?? null;
    return [{ ...p, cwd: p.cwd, agent, session }];
  });
}

/** プロセスを cwd で worktree に割り当てる（ネストした worktree に備えて最長一致） */
export function attachProcesses(repos: Repository[], procs: Proc[]): Repository[] {
  const wts = repos.flatMap((r) => r.worktrees.filter((w) => !w.bare)).sort((a, b) => b.path.length - a.path.length);
  const owned = new Map<Worktree, Proc[]>();
  for (const p of procs) {
    const w = wts.find((w) => isUnder(p.cwd, w.path));
    if (w) owned.set(w, [...(owned.get(w) ?? []), p]);
  }
  return repos.map((r) => ({ ...r, worktrees: r.worktrees.map((w) => ({ ...w, processes: owned.get(w) ?? [] })) }));
}

export interface Filter {
  all: boolean; // 何も動いていないリポジトリも出す
  agentsOnly: boolean; // エージェントのプロセスだけ（いない worktree は省く）
}

/** 既定は「追加 worktree があるか、何か動いている」リポジトリだけ */
export function selectRepos(repos: Repository[], f: Filter): Repository[] {
  const onlyAgents = (r: Repository): Repository => ({
    ...r,
    worktrees: r.worktrees
      .map((w) => ({ ...w, processes: w.processes.filter((p) => p.agent) }))
      .filter((w) => w.processes.length),
  });
  return repos
    .map((r) => (f.agentsOnly ? onlyAgents(r) : r))
    .filter((r) => r.worktrees.length)
    .filter((r) => f.all || f.agentsOnly || r.worktrees.length > 1 || r.worktrees.some((w) => w.processes.length));
}

// ---------------------------------------------------------------------
// セッション状態の遷移（Claude Code hook のイベント → 次の状態）
// ---------------------------------------------------------------------
/** hook に登録するイベントと matcher。applyHook が解釈するイベントと一致させる */
export const HOOK_EVENTS: Record<string, string | null> = {
  SessionStart: null,
  UserPromptSubmit: null,
  PostToolUse: "*", // 許可後の再開・サブエージェントの直近ツール
  PostToolUseFailure: "*",
  Notification: "permission_prompt|elicitation_dialog|agent_needs_input",
  Stop: null,
  StopFailure: null,
  SubagentStart: null,
  SubagentStop: null,
  SessionEnd: null,
};

/** hook の入力（使うフィールドだけ） */
export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  agent_id?: string; // サブエージェント内で発火したとき
  agent_type?: string;
  tool_name?: string;
  message?: string;
  last_assistant_message?: string;
  error?: string;
}

export interface HookOutcome {
  session?: SessionRecord | "delete";
  subagent?: Subagent;
  notify?: boolean;
}

export function applyHook(
  e: HookEvent,
  prev: { session: SessionRecord | null; subagent: Subagent | null },
  now: number,
): HookOutcome {
  const session = (status: SessionStatus, reason?: string): HookOutcome => {
    const p = prev.session;
    const changed = p?.status !== status;
    return {
      session: { id: e.session_id, pid: p?.pid ?? null, cwd: p?.cwd ?? e.cwd ?? "", status, reason, since: p && !changed ? p.since : now, updated: now },
      // 実行中への遷移と、起動直後の ready は通知しない
      notify: changed && status !== "running" && !(status === "ready" && !p),
    };
  };
  const subagent = (status: SubagentStatus, detail?: string): Subagent => {
    const p = prev.subagent;
    const type = e.agent_type ?? p?.type ?? "subagent";
    return { sessionId: e.session_id, id: e.agent_id ?? "", type, status, detail: detail ?? p?.detail, since: p?.status === status ? p.since : now, updated: now };
  };
  const inSubagent = Boolean(e.agent_id);

  switch (e.hook_event_name) {
    case "SessionStart":
      return session("ready");
    case "UserPromptSubmit":
      return session("running");
    case "Stop":
      return session("ready", firstLine(e.last_assistant_message));
    case "StopFailure":
      return session("error", firstLine(e.error ?? e.message));
    case "SessionEnd":
      return { session: "delete" };
    case "SubagentStart":
      return inSubagent ? { subagent: subagent("running") } : {};
    case "SubagentStop":
      return inSubagent ? { subagent: subagent("done", firstLine(e.last_assistant_message)) } : {};
    case "Notification": {
      const who = e.agent_type ? `[${e.agent_type}] ` : "";
      const main = session("waiting", firstLine(who + (e.message ?? "")));
      return inSubagent ? { ...main, subagent: subagent("waiting", firstLine(e.message)) } : main;
    }
    case "PostToolUse":
    case "PostToolUseFailure":
      if (!inSubagent) return session("running");
      // サブエージェントのツールが動いた = 本体が許可待ちなら許可された
      return { ...(prev.session?.status === "waiting" ? session("running") : {}), subagent: subagent("running", e.tool_name) };
    default:
      return {};
  }
}

const MINUTE = 60_000;
/** pid が分からないセッションを保持する期間 */
export const SESSION_TTL = 24 * 60 * MINUTE;
/** 完了したサブエージェントは2分表示に残す。更新が30分途絶えた実行中のもの（中断など）は捨てる */
export const subagentExpired = (a: Subagent, now: number) =>
  now - a.updated > (a.status === "done" ? 2 : 30) * MINUTE;

export function firstLine(s: string | undefined, max = 80): string | undefined {
  const line = s?.split("\n").map((l) => l.trim()).find(Boolean);
  return line && line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------
// 移動先のペイン特定
// ---------------------------------------------------------------------
/** pid の祖先を辿って pane_pid に行き着くペイン。なければ path 配下にいるペイン（完全一致・アクティブ優先） */
export function findPane(t: JumpTarget, panes: Pane[], parentOf: (pid: Pid) => Pid | undefined): Pane | undefined {
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  for (let pid = t.pid, i = 0; pid && pid > 1 && i < 32; pid = parentOf(pid), i++) {
    const hit = byPid.get(pid);
    if (hit) return hit;
  }
  const path = t.path;
  if (!path) return undefined;
  const score = (p: Pane) => Number(p.path === path) * 2 + Number(p.active);
  return panes.filter((p) => isUnder(p.path, path)).sort((a, b) => score(b) - score(a))[0];
}
