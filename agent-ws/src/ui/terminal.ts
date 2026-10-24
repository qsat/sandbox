/**
 * ターミナル出力: 表示モデル（Cell / Row）→ 文字列。色付けと表示幅の切り詰めだけを扱う
 */
import type { Cell, Row, Tone } from "./view.ts";

export type ColorMode = "none" | "ansi" | "tmux";

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

/** 1行に整形し、表示幅を超えたら切り詰める */
export function formatRow(row: Row, width: number, mode: ColorMode): string {
  let room = width - textWidth(row.prefix);
  let out = row.prefix;
  for (const [i, c] of row.cells.entries()) {
    const text = (i ? GAP : "") + c.text;
    const w = textWidth(text);
    if (w > room) return `${out}${paint(truncate(text, room - 1), c.tone, mode)}…`;
    out += paint(text, c.tone, mode);
    room -= w;
  }
  return out;
}

export const formatCells = (cells: Cell[], mode: ColorMode) => cells.map((c) => paint(c.text, c.tone, mode)).join(" ");

// 全角・絵文字は2桁（厳密な East Asian Width ではなく実用上の近似）
const WIDE = /[ᄀ-ᅟ⌚⌛⏩-⏳⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u;
const charWidth = (ch: string) => (WIDE.test(ch) ? 2 : 1);
const textWidth = (s: string) => [...s].reduce((n, ch) => n + charWidth(ch), 0);

function truncate(s: string, width: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    if (used + charWidth(ch) > width) break;
    out += ch;
    used += charWidth(ch);
  }
  return out;
}
