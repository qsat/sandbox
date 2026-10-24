/**
 * 常駐表示: 状態が変わるたびに描き直し、j/k で選択、Enter で移動する
 * 描画は状態を読むだけで、状態を書き換えない。選択中として出す行・スクロール位置は行の並びと画面の高さから導く。
 * 人の操作は出来事として伝えるだけで、結果は状態の変化として受け取る（popup を閉じるのも状態を見て決める）。
 * 何を表示するか・操作をどう伝えるかは関数で受け取る（このモジュールは Store の中身を知らない）
 */
import type { VisitTarget } from "../redux/types/visit.ts";
import type { ColorMode } from "./terminal.ts";
import { formatRow, paint } from "./terminal.ts";
import type { Cell, Row } from "./view.ts";

export interface WatchOptions {
  rows: () => Row[];
  view: () => { cursor: string | null; now: number; message?: Cell; close: boolean };
  subscribe: (onChange: () => void) => void; // 表示する状態が変わったら呼ばれる
  select: (key: string | null) => void; // 人が行を選んだ
  choose: (t: VisitTarget) => void; // 人が行き先を選んだ（Enter）
  reload: () => void; // 人が読み直しを頼んだ（r）
  color: ColorMode;
}

const selectable = (rows: Row[]) => rows.flatMap((r, i) => (r.key ? [i] : []));

/** 選択中として出す行: 人が選んだ行がまだあればそれ、無ければ優先度の一番高い行（なければ先頭）。行が無ければ -1 */
export function effectiveCursor(rows: Row[], cursor: string | null): number {
  const i = rows.findIndex((r) => r.key !== undefined && r.key === cursor);
  if (i >= 0) return i;
  const sel = selectable(rows);
  return sel.reduce((best, j) => ((rows[j].priority ?? 0) > (rows[best]?.priority ?? 0) ? j : best), sel[0] ?? -1);
}

/** 先頭に出す行: 選択中の行を含むページ（最後のページは画面いっぱいに出す） */
export function viewport(index: number, height: number, count: number): number {
  if (index < 0) return 0;
  return Math.max(0, Math.min(Math.floor(index / height) * height, count - height));
}

export function runWatch(o: WatchOptions): void {
  const out = process.stdout;
  const interactive = Boolean(process.stdin.isTTY);
  const height = () => Math.max(1, (out.rows ?? 40) - 4);

  const draw = () => {
    const rows = o.rows();
    const v = o.view();
    const idx = effectiveCursor(rows, v.cursor);
    const h = height();
    const top = viewport(idx, h, rows.length);
    const width = out.columns ?? 120;
    const time = new Date(v.now).toLocaleTimeString("ja-JP", { hour12: false });
    const help = interactive ? "j/k:選択  Enter:移動  r:更新  q:終了" : "Ctrl-C で終了";
    const body = rows.slice(top, top + h).map((r, i) => {
      if (!interactive) return formatRow(r, width, o.color);
      const mark = top + i === idx ? paint("❯ ", "agent", o.color) : "  ";
      return mark + formatRow(r, width - 2, o.color);
    });
    const footer = v.message ? ["", formatRow({ prefix: "", cells: [v.message] }, width, o.color)] : [];
    out.write(`\x1b[H\x1b[2J${[paint(`agent-ws  ${time}  ${help}`, "dim", o.color), "", ...body, ...footer].join("\n")}\n`);
  };

  const quit = () => {
    if (interactive) process.stdin.setRawMode(false);
    out.write("\x1b[?25h\n");
    process.exit(0);
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
  process.on("SIGINT", quit).on("SIGTERM", quit);
  out.on("resize", draw);
  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (key: string) => keys[key]?.());
  }
  // 状態が変わったら: 閉じるべきなら閉じる。そうでなければ、続く変化を 1 フレームにまとめて描き直す
  let pending = false;
  o.subscribe(() => {
    if (o.view().close) return quit();
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      draw();
    }, 30);
  });
  draw();
}
