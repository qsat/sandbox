import type { AgentNode, AgentStatus, Tree } from "@herdr-tools/ws-core";

/** 巡回に入れる status。上ほど先に回る */
export const CYCLE_ORDER: AgentStatus[] = ["blocked", "done", "idle"];

export const MESSAGE_WHEN_NO_CANDIDATE = "巡回するエージェントはありません";

export interface CycleCandidate {
  agent: AgentNode;
  workspace: string;
  worktree: string;
}

/**
 * 巡回の列。blocked → done → idle の順で、同じ status の中は status になった時刻が新しいものから。
 * 時刻が同じか取れない（statusMs が無い）ときはエージェント ID の順。alive でないものと、列に無い status は入れない
 */
export function cycleCandidates(tree: Tree): CycleCandidate[] {
  return tree.workspaces
    .flatMap((ws) => ws.worktrees.flatMap((wt) => wt.agents.map((agent) => ({ agent, workspace: ws.name, worktree: wt.path }))))
    .filter((c) => c.agent.alive && CYCLE_ORDER.includes(c.agent.status))
    .sort(
      (a, b) =>
        CYCLE_ORDER.indexOf(a.agent.status) - CYCLE_ORDER.indexOf(b.agent.status) ||
        (b.agent.statusMs ?? 0) - (a.agent.statusMs ?? 0) ||
        a.agent.id.localeCompare(b.agent.id, undefined, { numeric: true }),
    );
}

/** 続けて押したとみなす間隔。これ以上空いたら、前回の続きではなく列の端から回り直す */
export const CYCLE_BURST_MS = 3000;

/** 前回の巡回の記録。order は前回の列の順、lastId は前回移った先 */
export interface CycleRecord {
  atMs: number;
  order: string[];
  lastId: string;
}

/** 前回から CYCLE_BURST_MS 未満なら前回の記録を返し、間が空いていれば null（回り直す） */
export function continuingRecord(record: CycleRecord | null, nowMs: number, burstMs = CYCLE_BURST_MS) {
  if (!record) return null;
  const elapsed = nowMs - record.atMs;
  return elapsed >= 0 && elapsed < burstMs ? record : null;
}

/** 続けて押している間は、状態が変わっても前回の列の順を保つ。列から外れたエージェントは飛ばす */
export function inRecordedOrder(candidates: CycleCandidate[], order: string[]) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return candidates.filter((c) => rank.has(c.agent.id)).sort((a, b) => rank.get(a.agent.id)! - rank.get(b.agent.id)!);
}

/** 今のエージェントの次。最後なら先頭へ戻り、列に無ければ先頭 */
export function nextCandidate(candidates: CycleCandidate[], currentAgentId: string | null | undefined) {
  const at = candidates.findIndex((c) => c.agent.id === currentAgentId);
  return candidates[(at + 1) % candidates.length];
}

/** 今のエージェントの 1 つ前。先頭なら最後へ回り、列に無ければ最後 */
export function prevCandidate(candidates: CycleCandidate[], currentAgentId: string | null | undefined) {
  const at = candidates.findIndex((c) => c.agent.id === currentAgentId);
  return candidates[at < 0 ? candidates.length - 1 : (at - 1 + candidates.length) % candidates.length];
}

/**
 * 巡回で「今いるペイン」を決める。
 * 優先順: 明示（--pane）> 環境変数（TMUX_PANE）> 移動に使うクライアントが表示しているペイン > 表示中のペインの最初の 1 つ
 */
export function decideCurrentPane(opts: { explicit?: string; envPane?: string; clientPane?: string; displayedPanes: string[] }) {
  return opts.explicit || opts.envPane || opts.clientPane || opts.displayedPanes[0] || undefined;
}
