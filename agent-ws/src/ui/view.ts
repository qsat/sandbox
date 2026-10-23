/**
 * 表示モデル: ドメイン → 行（Row）。何を・どんな意味で見せるかだけ決め、色や装飾はしない
 */
import type { JumpResult, JumpTarget, Notice, Proc, Repository, Session, SessionStatus, Status, Worktree } from "../domain.ts";
import { isBlocked, isUnder, repoName } from "../domain.ts";

/** 意味としてのトーン。実際の色は terminal.ts が決める */
export type Tone = "plain" | "strong" | "dim" | "title" | "agent" | "ok" | "warn" | Status;

export interface Cell {
  text: string;
  tone: Tone;
}

export interface Row {
  prefix: string; // ツリーの罫線
  cells: Cell[];
  key?: string; // 選択できる行の識別子（再描画をまたいでカーソル位置を保つ）
  target?: JumpTarget;
  priority?: number; // 最初に選ぶ行の優先度（許可・質問待ち > 完了して未確認 > その他のエージェント）
}

export const STATUS: Record<Status, { icon: string; label: string }> = {
  waiting: { icon: "⏳", label: "許可待ち" },
  asking: { icon: "❓", label: "質問待ち" },
  ready: { icon: "✓", label: "入力待ち" },
  running: { icon: "●", label: "実行中" },
  error: { icon: "✗", label: "エラー" },
  done: { icon: "✓", label: "完了" },
};

export interface ViewOptions {
  compact: boolean; // エージェント以外のプロセスは件数だけ（常駐表示向け）
  roots: string[];
  home: string;
  now: number;
}

const cell = (text: string, tone: Tone = "plain"): Cell => ({ text, tone });
/** 条件が真のときだけセルを入れる */
const when = (cond: unknown, ...cells: Cell[]) => (cond ? cells : []);
const shortName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------
// ツリー: リポジトリ > worktree > プロセス > サブエージェント
// ---------------------------------------------------------------------
interface Node extends Omit<Row, "prefix"> {
  children: Node[];
}

const toRow = ({ children: _, ...row }: Node, prefix: string): Row => ({ ...row, prefix });

/** 階層の深さを問わず、罫線つきの行に平らにする */
function flatten(nodes: Node[], indent = ""): Row[] {
  return nodes.flatMap((n, i) => {
    const last = i === nodes.length - 1;
    return [toRow(n, indent + (last ? "└─ " : "├─ ")), ...flatten(n.children, indent + (last ? "   " : "│  "))];
  });
}

export function treeRows(repos: Repository[], o: ViewOptions): Row[] {
  if (!repos.length) return [{ prefix: "", cells: [cell("該当するリポジトリはありません（--all で全件表示）", "dim")] }];
  const blank: Row = { prefix: "", cells: [] };
  return [
    ...repos.flatMap((r) => {
      const node = repoNode(r, o);
      return [toRow(node, ""), ...flatten(node.children), blank];
    }),
    summaryRow(repos),
  ];
}

function repoNode(r: Repository, o: ViewOptions): Node {
  const agents = r.worktrees.flatMap((w) => w.processes.filter((p) => p.agent));
  const count = (st: SessionStatus) => agents.filter((p) => p.session?.status === st).length;
  return {
    cells: [
      cell(r.name, "title"),
      cell(`${r.worktrees.length} worktrees`, "dim"),
      ...when(agents.length, cell(`${agents.length} agents`, "agent")),
      ...(["waiting", "asking"] as const).flatMap((st) => when(count(st), cell(`${STATUS[st].icon}${count(st)}`, st))),
    ],
    key: `repo:${r.path}`,
    target: { title: r.name, name: shortName(r.name), pid: agents[0]?.pid, path: agents[0]?.cwd ?? r.path },
    children: r.worktrees.map((w) => worktreeNode(r, w, o)),
  };
}

function worktreeNode(r: Repository, w: Worktree, o: ViewOptions): Node {
  const shown = o.compact ? w.processes.filter((p) => p.agent) : w.processes;
  const name = w.branch ?? w.head;
  const title = `${shortName(r.name)} [${name}]`;
  // メインはリポジトリ名と同じなので場所は省く。ghq 配下なら相対名、外なら ~ 表記
  const where = o.roots.some((root) => isUnder(w.path, root))
    ? repoName(w.path, o.roots)
    : isUnder(w.path, o.home) ? `~${w.path.slice(o.home.length)}` : w.path;
  return {
    cells: [
      cell(w.branch ?? `(detached ${w.head})`, "strong"),
      cell(w.head, "dim"),
      ...when(w.isMain, cell("main")),
      ...when(w.bare, cell("bare")),
      ...when(w.locked, cell("locked")),
      ...when(w.prunable, cell("prunable", "warn")),
      ...when(w.dirty !== null, w.dirty ? cell(`dirty:${w.dirty}`, "warn") : cell("clean", "ok")),
      ...when(shown.length < w.processes.length, cell(`+${w.processes.length - shown.length} procs`, "dim")),
      ...when(w.path !== r.path, cell(where, "dim")),
    ],
    key: `wt:${w.path}`,
    target: { title, name, pid: w.processes.find((p) => p.agent)?.pid, path: w.path },
    children: shown.map((p) => procNode(p, w, title, o.now)),
  };
}

function procNode(p: Proc, w: Worktree, title: string, now: number): Node {
  const key = `pid:${p.pid}`;
  const target: JumpTarget = { title: `${title} pid ${p.pid}`, name: title, pid: p.pid, path: p.cwd };
  if (!p.agent) {
    const dir = p.cwd === w.path ? "" : `${p.cwd.slice(w.path.length + 1)}/ `;
    return { cells: [cell(String(p.pid).padStart(7)), cell(p.elapsed.padStart(11), "dim"), cell(dir + p.command)], key, target, children: [] };
  }
  const s = p.session;
  return {
    cells: [
      cell(`[${p.agent}]`.padEnd(9), "agent"),
      // 完了して未確認なら「完了」、見た後は「入力待ち」
      ...(s ? statusCells(s.unseen ? "done" : s.status, now - s.since, s.unseen ? "ok" : s.status) : [cell("? 状態不明", "dim")]),
      cell(`pid ${p.pid}`, "dim"),
      ...when(s?.reason, cell(s?.reason ?? "", "dim")),
    ],
    key,
    target,
    priority: isBlocked(s?.status) ? 3 : s?.unseen ? 2 : 1,
    // サブエージェントは本体プロセス内で動くので、移動先は本体と同じ
    children: (s?.subagents ?? []).map((a) => ({
      cells: [
        cell(`⤷ ${a.type}`.padEnd(15), a.status === "done" ? "dim" : "plain"),
        ...statusCells(a.status, now - a.since),
        ...when(a.detail, cell(a.detail ?? "", "dim")),
      ],
      key: `sub:${a.sessionId}:${a.id}`,
      target,
      children: [],
    })),
  };
}

const statusCells = (st: Status, elapsedMs: number, tone: Tone = st) => [
  cell(`${STATUS[st].icon} ${STATUS[st].label}`, tone),
  cell(duration(elapsedMs).padStart(4), "dim"),
];

function summaryRow(repos: Repository[]): Row {
  const agents = repos.flatMap((r) => r.worktrees.flatMap((w) => w.processes.filter((p) => p.agent)));
  const worktrees = repos.reduce((n, r) => n + r.worktrees.length, 0);
  return {
    prefix: "",
    cells: [
      cell(`${repos.length} repos / ${worktrees} worktrees / ${agents.length} agents`, "dim"),
      ...statusCounts(agents.flatMap((p) => p.session ?? [])),
    ],
  };
}

// ---------------------------------------------------------------------
// ステータスライン・通知・移動結果
// ---------------------------------------------------------------------
/** 状態ごとの件数（一覧のフッター） */
function statusCounts(sessions: Session[]): Cell[] {
  const order: SessionStatus[] = ["waiting", "asking", "error", "ready", "running"];
  const subs = sessions.flatMap((s) => s.subagents).filter((a) => a.status !== "done").length;
  return [
    ...order.flatMap((st) => {
      const n = sessions.filter((s) => s.status === st).length;
      return when(n, cell(`${STATUS[st].icon}${n} ${STATUS[st].label}`, st));
    }),
    ...when(subs, cell(`⤷${subs} サブエージェント稼働`, "running")),
  ];
}

/** ステータスライン: 人の対応が要るものの有無だけ（中身はポップアップで見る） */
export const statusLine = (sessions: Session[]): Cell[] => [
  ...when(sessions.some((s) => s.status === "waiting"), cell(STATUS.waiting.icon, "waiting")),
  ...when(sessions.some((s) => s.status === "asking"), cell(STATUS.asking.icon, "asking")),
  ...when(sessions.some((s) => s.unseen), cell(STATUS.done.icon, "ok")),
  ...when(sessions.some((s) => s.status === "error"), cell(STATUS.error.icon, "error")),
];

export function notification({ repo, branch, session }: Notice): { title: string; body: string } {
  const s = STATUS[session.status];
  return {
    title: `${shortName(repo)}${branch ? ` [${branch}]` : ""}`,
    body: `${s.icon} ${s.label}${session.reason ? `: ${session.reason}` : ""}`,
  };
}

export function jumpMessage(r: JumpResult): Cell {
  const pane = (p: { session: string; window: string; windowName: string; id: string }) =>
    `${p.session}:${p.window} (${p.windowName}) ${p.id}`;
  switch (r.kind) {
    case "focused":
      return cell(`→ ${pane(r.pane)}`, "ok");
    case "found":
      return cell(pane(r.pane));
    case "created":
      return cell(`→ 新しいウィンドウ ${r.path}`, "ok");
    case "notFound":
      return cell(`${r.title} を表示しているペインがありません`, "warn");
    case "failed":
      return cell(`${r.title} へ移動できませんでした（tmux クライアントの外？）`, "warn");
  }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
