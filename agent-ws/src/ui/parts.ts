/**
 * 表示の部品: セル・行・状況の見せ方。何を・どんな意味で見せるかだけ決め、色や装飾はしない（色は terminal.ts）
 */
import type { Status } from "../redux/types/agent.ts";
import type { VisitTarget } from "../redux/types/visit.ts";

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

export const cell = (text: string, tone: Tone = "plain"): Cell => ({ text, tone });
/** 条件が真のときだけセルを入れる */
export const when = (cond: unknown, ...cells: Cell[]) => cells.filter(() => Boolean(cond));

/** 経過時間（4s・3m・2h5m・1d） */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
