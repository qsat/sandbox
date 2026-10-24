/**
 * 表示モデル: ドメイン → 行（Row）。何を・どんな意味で見せるかだけ決め、色や装飾はしない
 */
import { isBlocked, visibleSubagents } from "../redux/modules/app/agents/selector.ts";
import { attentionOf } from "../redux/modules/app/attention/selector.ts";
import type { Agent, Status, TurnStatus } from "../redux/types/agent.ts";
import type { Notice, StatusFlags } from "../redux/types/attention.ts";
import type { VisitResult, VisitTarget } from "../redux/types/visit.ts";
import type { AgentAt, Repository, Worktree } from "../redux/types/workspace.ts";
import { isUnder } from "../redux/utils/isUnder.ts";
import { repoName } from "../redux/utils/repoName.ts";

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
  target?: VisitTarget;
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
  roots: string[];
  home: string;
  now: number;
}

const cell = (text: string, tone: Tone = "plain"): Cell => ({ text, tone });
/** 条件が真のときだけセルを入れる */
const when = (cond: unknown, ...cells: Cell[]) => (cond ? cells : []);
const shortName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------
// ツリー: リポジトリ > worktree > エージェント > サブエージェント
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
  const agents = r.worktrees.flatMap((w) => w.agents);
  const count = (st: TurnStatus) => agents.filter((x) => x.agent && attentionOf(x.agent).status === st).length;
  return {
    cells: [
      cell(r.name, "title"),
      cell(`${r.worktrees.length} worktrees`, "dim"),
      ...when(agents.length, cell(`${agents.length} agents`, "agent")),
      ...(["waiting", "asking"] as const).flatMap((st) => when(count(st), cell(`${STATUS[st].icon}${count(st)}`, st))),
    ],
    key: `repo:${r.path}`,
    target: { title: r.name, name: shortName(r.name), pid: agents[0]?.process.pid, path: agents[0]?.process.cwd ?? r.path },
    children: r.worktrees.map((w) => worktreeNode(r, w, o)),
  };
}

function worktreeNode(r: Repository, w: Worktree, o: ViewOptions): Node {
  const name = w.branch ?? w.head;
  const title = `${shortName(r.name)} [${name}]`;
  // メインはリポジトリ名と同じなので場所は省く。ghq 配下なら相対名、外なら ~ 表記
  const where = o.roots.some((root) => isUnder(w.path, root))
    ? repoName(w.path, o.roots)
    : isUnder(w.path, o.home)
      ? `~${w.path.slice(o.home.length)}`
      : w.path;
  return {
    cells: [
      cell(w.branch ?? `(detached ${w.head})`, "strong"),
      cell(w.head, "dim"),
      ...when(w.isMain, cell("main")),
      ...when(w.bare, cell("bare")),
      ...when(w.locked, cell("locked")),
      ...when(w.prunable, cell("prunable", "warn")),
      ...when(w.dirty !== null, w.dirty ? cell(`dirty:${w.dirty}`, "warn") : cell("clean", "ok")),
      ...when(w.path !== r.path, cell(where, "dim")),
    ],
    key: `wt:${w.path}`,
    target: { title, name, pid: w.agents[0]?.process.pid, path: w.path },
    children: w.agents.map((x) => agentNode(x, title, o.now)),
  };
}

function agentNode({ process: p, agent: a, unseen }: AgentAt, title: string, now: number): Node {
  const target: VisitTarget = { title: `${title} pid ${p.pid}`, name: title, pid: p.pid, path: p.cwd };
  // サブエージェントが許可を待っていれば本体も許可待ち（詳細はサブエージェントの行に出る）
  const at = a && attentionOf(a);
  return {
    cells: [
      cell(`[${p.kind}]`.padEnd(9), "agent"),
      // 完了して未確認なら「完了」、見た後は「入力待ち」
      ...(at ? statusCells(unseen ? "done" : at.status, now - at.since, unseen ? "ok" : at.status) : [cell("? 状態不明", "dim")]),
      cell(`pid ${p.pid}`, "dim"),
      ...when(at?.reason, cell(at?.reason ?? "", "dim")),
    ],
    key: `pid:${p.pid}`,
    target,
    priority: isBlocked(at?.status) ? 3 : unseen ? 2 : 1,
    // サブエージェントは本体のプロセス内で動くので、行き先は本体と同じ
    children: (a ? visibleSubagents(a, now) : []).map((s) => ({
      cells: [
        cell(`⤷ ${s.type}`.padEnd(15), s.status === "done" ? "dim" : "plain"),
        ...statusCells(s.status, now - s.since),
        ...when(s.detail, cell(s.detail ?? "", "dim")),
      ],
      key: `sub:${a?.id}:${s.id}`,
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
  const agents = repos.flatMap((r) => r.worktrees.flatMap((w) => w.agents));
  const worktrees = repos.reduce((n, r) => n + r.worktrees.length, 0);
  return {
    prefix: "",
    cells: [
      cell(`${repos.length} repos / ${worktrees} worktrees / ${agents.length} agents`, "dim"),
      ...statusCounts(agents.flatMap((x) => x.agent ?? [])),
    ],
  };
}

// ---------------------------------------------------------------------
// ステータスライン・通知・移動結果
// ---------------------------------------------------------------------
/** 状態ごとの件数（一覧のフッター） */
function statusCounts(agents: Agent[]): Cell[] {
  const order: TurnStatus[] = ["waiting", "asking", "error", "ready", "running"];
  const subs = agents.flatMap((a) => Object.values(a.subagents)).filter((s) => s.status !== "done").length;
  return [
    ...order.flatMap((st) => {
      const n = agents.filter((a) => attentionOf(a).status === st).length;
      return when(n, cell(`${STATUS[st].icon}${n} ${STATUS[st].label}`, st));
    }),
    ...when(subs, cell(`⤷${subs} サブエージェント稼働`, "running")),
  ];
}

/** ステータスライン: 人の対応が要るものの有無だけ（中身はポップアップで見る） */
export const statusLine = (f: StatusFlags): Cell[] => [
  ...when(f.waiting, cell(STATUS.waiting.icon, "waiting")),
  ...when(f.asking, cell(STATUS.asking.icon, "asking")),
  ...when(f.unseen, cell(STATUS.done.icon, "ok")),
  ...when(f.error, cell(STATUS.error.icon, "error")),
];

export function notification({ repo, branch, kind, reason }: Notice): { title: string; body: string } {
  const s = kind === "ready" ? STATUS.done : STATUS[kind];
  return {
    title: `${shortName(repo)}${branch ? ` [${branch}]` : ""}`,
    body: `${s.icon} ${s.label}${reason ? `: ${reason}` : ""}`,
  };
}

export function visitMessage(r: VisitResult): Cell {
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
