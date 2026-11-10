/**
 * ターミナル出力: 表示モデル（Cell / Row）→ 文字列。色付けと表示幅の切り詰めだけを扱う
 */
import { scan } from "../lib/scan.ts";
import type { Cell, Row, Tone } from "./parts.ts";

export type ColorMode = "none" | "ansi" | "tmux";

/** 出力先の端末: 色の付け方・幅・ホーム（パスを ~ で縮める） */
export interface Display {
  color: ColorMode;
  width: number;
  home: string;
}

const ANSI: Record<Tone, string> = {
  plain: "",
  strong: "1",
  dim: "2",
  title: "1;36",
  agent: "35",
  ok: "32",
  warn: "33",
  waiting: "1;33",
  asking: "1;34",
  ready: "32",
  running: "36",
  error: "31",
  done: "2;32",
};
const TMUX: Partial<Record<Tone, string>> = {
  agent: "magenta",
  ok: "green",
  warn: "yellow",
  waiting: "yellow",
  asking: "blue",
  ready: "green",
  running: "cyan",
  error: "red",
  done: "green",
};
const GAP = "  ";

export function paint(text: string, tone: Tone, mode: ColorMode): string {
  if (mode === "ansi" && ANSI[tone]) return `\x1b[${ANSI[tone]}m${text}\x1b[0m`;
  if (mode === "tmux" && TMUX[tone]) return `#[fg=${TMUX[tone]}]${text}#[default]`;
  return text;
}

/** 2つ目以降のセルは間を空ける */
const spaced = (c: Cell, i: number): Cell => {
  if (i === 0) return c;
  return { ...c, text: GAP + c.text };
};

/** 1行に整形し、表示幅を超えたら切り詰める */
export function formatRow(row: Row, width: number, mode: ColorMode): string {
  const cells = row.cells.map(spaced);
  const room = width - textWidth(row.prefix);
  const ends = cumulative(cells.map((c) => textWidth(c.text))); // 各セルの右端
  const over = ends.findIndex((end) => end > room);
  const painted = (cs: Cell[]) => cs.map((c) => paint(c.text, c.tone, mode)).join("");
  if (over < 0) return row.prefix + painted(cells);
  const cut = cells[over];
  const rest = room - (ends[over - 1] ?? 0) - 1; // 「…」の分を残す
  return `${row.prefix}${painted(cells.slice(0, over))}${paint(truncate(cut.text, rest), cut.tone, mode)}…`;
}

export const formatCells = (cells: Cell[], mode: ColorMode) => cells.map((c) => paint(c.text, c.tone, mode)).join(" ");

// 全角・絵文字は2桁（厳密な East Asian Width ではなく実用上の近似）
const WIDE =
  /[\u1100-\u115F\u231A\u231B\u23E9-\u23F3\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1f300}-\u{1faff}]/u;
const charWidth = (ch: string) => 1 + Number(WIDE.test(ch));
const textWidth = (s: string) => [...s].reduce((n, ch) => n + charWidth(ch), 0);

/** 累積和（先頭からそこまでの合計） */
const cumulative = (xs: number[]) => scan(xs, (sum, x) => sum + x, 0);

/** 表示幅 width に収まるところまで */
function truncate(s: string, width: number): string {
  const chars = [...s];
  const fits = cumulative(chars.map(charWidth)).filter((end) => end <= width).length;
  return chars.slice(0, fits).join("");
}
