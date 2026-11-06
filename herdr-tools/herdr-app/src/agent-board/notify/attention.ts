// 通知するかの判断。エージェントの status の変化だけを見る。I/O なし
import type { BoardRow } from "../board";

export type AgentRow = Extract<BoardRow, { kind: "agent" }>;

/** 知らせる変化 1 つ。before は前回見た status */
export interface AttentionChange {
  row: AgentRow;
  before: string;
}

/**
 * status が before から after に変わったとき、ユーザーに知らせるか。
 * - 前回の status が分からない（before が無い）ときは知らせない。起動直後に現れたときと、一覧の読み直しで
 *   一度見えなくなって戻ったときに、変わっていないのに知らせてしまうため
 * - blocked（ユーザーを待っている）と done（見ていない間に終わった）は、どこから変わっても知らせる
 * - idle は working から変わったとき（作業が終わった）だけ知らせる。Herdr は done を見ると idle に戻すので、
 *   done から idle は「見た」だけで知らせない
 */
export function shouldNotify(before: string | undefined, after: string) {
  if (before === undefined || before === after) return false;
  if (after === "blocked" || after === "done") return true;
  return after === "idle" && before === "working";
}

/**
 * 前回見た status と比べ、知らせる変化（shouldNotify）があったエージェントを返す。
 * prev が null（mod を読み込んで最初の 1 回）は、今の status を覚えるだけで何も返さない。読み込み直しのたびに通知が出ないようにするため。
 * 今回の一覧にいないエージェントの status は覚えたままにする（一時的に見えなくなっただけなら、戻ったときに知らせない）
 */
export function attentionChanges(prev: Map<string, string> | null, rows: BoardRow[]): { changed: AttentionChange[]; next: Map<string, string> } {
  const agents = rows.filter((r): r is AgentRow => r.kind === "agent");
  const next = new Map(prev ?? []);
  for (const a of agents) next.set(a.key, a.rawStatus);
  if (prev === null) return { changed: [], next };
  const changed = agents.flatMap((row) => {
    const before = prev.get(row.key);
    return before !== undefined && shouldNotify(before, row.rawStatus) ? [{ row, before }] : [];
  });
  return { changed, next };
}
