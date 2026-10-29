/**
 * 常駐表示: 状態が変わるたびに描き直し、j/k で選択、Enter で移動する
 * 描画は状態を読むだけで、状態を書き換えない。選択中として出す行・スクロール位置は行の並びと画面の高さから導く。
 * 人の操作は出来事として伝えるだけで、結果は状態の変化として受け取る（popup を閉じるのも状態を見て決める）。
 * 何を表示するか・操作をどう伝えるかは関数で受け取る（このモジュールは Store の中身を知らない）
 */
import { debounce } from "../lib/debounce.ts";
import type { VisitTarget } from "../redux/types/visit.ts";
import type { Cell, Row } from "./parts.ts";
import type { ColorMode } from "./terminal.ts";
import { formatRow, paint } from "./terminal.ts";

/** 端末（プロセスの境界が渡す）: 入力・出力・終わらせる合図・終わり方 */
export interface Terminal {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  onStop: (stop: () => void) => void; // SIGINT・SIGTERM など
  exit: () => void;
}

export interface TuiOptions {
  terminal: Terminal;
  rows: () => Row[];
  view: () => { cursor: string | null; now: number; message?: Cell; close: boolean };
  subscribe: (onChange: () => void) => void; // 表示する状態が変わったら呼ばれる
  select: (key: string | null) => void; // 人が行を選んだ
  choose: (t: VisitTarget) => void; // 人が行き先を選んだ（Enter）
  reload: () => void; // 人が読み直しを頼んだ（r）
  color: ColorMode;
}

/** 選べる行の位置 */
const selectable = (rows: Row[]) =>
  rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.key)
    .map(({ i }) => i);

/** 選択中として出す行: 人が選んだ行がまだあればそれ、無ければ優先度の一番高い行（なければ先頭）。行が無ければ -1 */
export function effectiveCursor(rows: Row[], cursor: string | null): number {
  const i = rows.findIndex((r) => r.key !== undefined && r.key === cursor);
  if (i >= 0) return i;
  const priority = (j: number) => rows[j].priority ?? 0;
  return selectable(rows).toSorted((a, b) => priority(b) - priority(a))[0] ?? -1; // 同じ優先度なら上の行
}

/** 先頭に出す行: 選択中の行を含むページ（最後のページは画面いっぱいに出す） */
export function viewport(index: number, height: number, count: number): number {
  if (index < 0) return 0;
  return Math.max(0, Math.min(Math.floor(index / height) * height, count - height));
}

const helpOf = (interactive: boolean) => {
  if (interactive) return "j/k:選択  Enter:移動  r:更新  q:終了";
  return "Ctrl-C で終了";
};

/** 選択中の行の印 */
const markOf = (selected: boolean, color: ColorMode) => {
  if (selected) return paint("❯ ", "agent", color);
  return "  ";
};

/** 移動の結果などのメッセージ（無ければ出さない） */
const footerOf = (message: Cell | undefined, width: number, color: ColorMode) => {
  if (!message) return [];
  return ["", formatRow({ prefix: "", cells: [message] }, width, color)];
};

export function runTui(o: TuiOptions): void {
  const { input, output: out } = o.terminal;
  const interactive = Boolean(input.isTTY);
  const height = () => Math.max(1, (out.rows ?? 40) - 4);

  const draw = () => {
    const rows = o.rows();
    const v = o.view();
    const idx = effectiveCursor(rows, v.cursor);
    const h = height();
    const top = viewport(idx, h, rows.length);
    const width = out.columns ?? 120;
    const time = new Date(v.now).toLocaleTimeString("ja-JP", { hour12: false });
    const body = rows.slice(top, top + h).map((r, i) => {
      if (!interactive) return formatRow(r, width, o.color);
      return markOf(top + i === idx, o.color) + formatRow(r, width - 2, o.color);
    });
    const header = paint(`agent-ws  ${time}  ${helpOf(interactive)}`, "dim", o.color);
    out.write(`\x1b[H\x1b[2J${[header, "", ...body, ...footerOf(v.message, width, o.color)].join("\n")}\n`);
  };

  const quit = () => {
    if (interactive) input.setRawMode(false);
    out.write("\x1b[?25h\n");
    o.terminal.exit();
  };
  const move = (delta: number) => {
    const rows = o.rows();
    const sel = selectable(rows);
    const pos = sel.indexOf(effectiveCursor(rows, o.view().cursor));
    o.select(rows[sel[Math.max(0, Math.min(sel.length - 1, pos + delta))]]?.key ?? null);
  };
  const enter = () => {
    const rows = o.rows();
    const target = rows[effectiveCursor(rows, o.view().cursor)]?.target;
    if (target) o.choose(target);
  };
  const keys: Record<string, () => void> = {
    j: () => move(1),
    "\x1b[B": () => move(1),
    k: () => move(-1),
    "\x1b[A": () => move(-1),
    g: () => move(-Infinity),
    G: () => move(Infinity),
    r: () => o.reload(),
    "\r": enter,
    q: quit,
    "\x1b": quit,
    "\x03": quit,
  };

  out.write("\x1b[?25l"); // カーソル非表示
  o.terminal.onStop(quit);
  out.on("resize", draw);
  if (interactive) {
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", (key: string) => keys[key]?.());
  }
  // 状態が変わったら: 閉じるべきなら閉じる。そうでなければ、続く変化を 1 フレームにまとめて描き直す
  const redraw = debounce(draw, 30);
  o.subscribe(() => {
    if (o.view().close) return quit();
    redraw();
  });
  draw();
}
