/**
 * 一覧（list・watch）: 状態 → リポジトリ > worktree > エージェント > サブエージェント のツリー
 */
import { visibleSubagents } from "../redux/modules/app/agents/selector.ts";
import { attentionOf } from "../redux/modules/app/attention/selector.ts";
import { selectNow } from "../redux/modules/app/lifecycle/selector.ts";
import { selectRoots, selectTree } from "../redux/modules/app/workspace/selector.ts";
import type { RootState } from "../redux/rootReducer.ts";
import type { Agent, Status, Subagent, TurnStatus } from "../redux/types/agent.ts";
import type { Attention } from "../redux/types/attention.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import type { AgentAt, Filter, Repository, Worktree } from "../redux/types/workspace.ts";
import { isBlocked } from "../redux/utils/isBlocked.ts";
import { isUnder } from "../redux/utils/isUnder.ts";
import { repoName } from "../redux/utils/repoName.ts";
import { type Cell, cell, duration, type Row, STATUS, shortName, type Tone, when } from "./parts.ts";
import { type Display, formatRow } from "./terminal.ts";

export interface ViewOptions {
  roots: string[];
  home: string;
  now: number;
}

interface Node extends Omit<Row, "prefix"> {
  children: Node[];
}

const toRow = ({ children: _, ...row }: Node, prefix: string): Row => ({ ...row, prefix });

/** 罫線: 兄弟の最後かどうかで、その行の枝と、子の行の左に続く線が変わる */
const branch = (last: boolean) => {
  if (last) return { self: "└─ ", children: "   " };
  return { self: "├─ ", children: "│  " };
};

/** 階層の深さを問わず、罫線つきの行に平らにする */
function flatten(nodes: Node[], indent = ""): Row[] {
  return nodes.flatMap((n, i) => {
    const b = branch(i === nodes.length - 1);
    return [toRow(n, indent + b.self), ...flatten(n.children, indent + b.children)];
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
  return {
    cells: [
      cell(w.branch ?? `(detached ${w.head})`, "strong"),
      cell(w.head, "dim"),
      ...when(w.isMain, cell("main")),
      ...when(w.bare, cell("bare")),
      ...when(w.locked, cell("locked")),
      ...when(w.prunable, cell("prunable", "warn")),
      ...dirtyCells(w.dirty),
      // メインはリポジトリ名と同じなので場所は省く
      ...when(w.path !== r.path, cell(placeOf(w.path, o), "dim")),
    ],
    key: `wt:${w.path}`,
    target: { title, name, pid: w.agents[0]?.process.pid, path: w.path },
    children: w.agents.map((x) => agentNode(x, title, o.now)),
  };
}

/** worktree の場所: ghq 配下なら相対名、ホーム配下なら ~ 表記 */
function placeOf(path: string, o: ViewOptions): string {
  if (o.roots.some((root) => isUnder(path, root))) return repoName(path, o.roots);
  if (isUnder(path, o.home)) return `~${path.slice(o.home.length)}`;
  return path;
}

/** 変更件数（数えていなければ出さない） */
function dirtyCells(dirty: number | null): Cell[] {
  if (dirty === null) return [];
  if (dirty === 0) return [cell("clean", "ok")];
  return [cell(`dirty:${dirty}`, "warn")];
}

function agentNode({ process: p, agent: a, unseen }: AgentAt, title: string, now: number): Node {
  const target: VisitTarget = { title: `${title} pid ${p.pid}`, name: title, pid: p.pid, path: p.cwd };
  // サブエージェントが許可を待っていれば本体も許可待ち（詳細はサブエージェントの行に出る）
  const at = a && attentionOf(a);
  return {
    cells: [
      cell(`[${p.kind}]`.padEnd(9), "agent"),
      ...agentStatusCells(at, unseen, now),
      cell(`pid ${p.pid}`, "dim"),
      ...when(at?.reason, cell(at?.reason ?? "", "dim")),
    ],
    key: `pid:${p.pid}`,
    target,
    priority: priorityOf(at, unseen),
    children: subagentNodes(a, target, now),
  };
}

/** 完了して未確認なら「完了」、見た後は「入力待ち」。hook で状況が分からなければ不明 */
function agentStatusCells(at: Attention | null, unseen: boolean, now: number): Cell[] {
  if (!at) return [cell("? 状態不明", "dim")];
  if (unseen) return statusCells("done", now - at.since, "ok");
  return statusCells(at.status, now - at.since);
}

/** 最初に選ぶ行の優先度: 許可・質問待ち > 完了して未確認 > その他 */
function priorityOf(at: Attention | null, unseen: boolean): number {
  if (isBlocked(at?.status)) return 3;
  if (unseen) return 2;
  return 1;
}

/** サブエージェントは本体のプロセス内で動くので、行き先は本体と同じ */
function subagentNodes(a: Agent | null, target: VisitTarget, now: number): Node[] {
  if (!a) return [];
  return visibleSubagents(a, now).map((s) => ({
    cells: [
      cell(`⤷ ${s.type}`.padEnd(15), subagentTone(s)),
      ...statusCells(s.status, now - s.since),
      ...when(s.detail, cell(s.detail ?? "", "dim")),
    ],
    key: `sub:${a.id}:${s.id}`,
    target,
    children: [],
  }));
}

const subagentTone = (s: Subagent): Tone => {
  if (s.status === "done") return "dim";
  return "plain";
};

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

/** 状態 → 一覧の行 */
export const listRows = (st: RootState, filter: Filter, home: string): Row[] =>
  treeRows(selectTree(st, filter), { roots: selectRoots(st), home, now: selectNow(st) });

export function listText(st: RootState, o: { filter: Filter; json: boolean }, d: Display): string {
  if (o.json) return JSON.stringify(selectTree(st, o.filter), null, 2);
  return listRows(st, o.filter, d.home)
    .map((row) => formatRow(row, d.width, d.color))
    .join("\n");
}
