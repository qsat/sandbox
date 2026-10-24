/**
 * 常駐表示: 状態が変わるたびに描き直し、j/k で選択、Enter で移動する
 * 選択中の行・スクロール位置は呼び出し側の状態（Store の ui.watch）にあり、ここは読んで描くのと、変更を頼むだけ。
 * 何を表示するか・どう移動するかも関数で受け取る（このモジュールは I/O の中身を知らない）
 */
import type { VisitTarget } from "../redux/types/visit.ts";
import type { ColorMode } from "./terminal.ts";
import { formatRow, paint } from "./terminal.ts";
import type { Cell, Row } from "./view.ts";

export interface WatchOptions {
  rows: () => Row[];
  view: () => { cursor: string | null; top: number; message?: Cell };
  subscribe: (onChange: () => void) => void; // 表示する状態が変わったら呼ばれる
  select: (key: string | null) => void;
  scroll: (top: number) => void;
  visit: (t: VisitTarget) => boolean; // 移動できたら true（結果のメッセージは view().message に出る）
  reload: () => void; // r キー: リポジトリ構成から読み直す
  exitOnVisit: boolean; // display-popup 内で使うとき、移動したら閉じる
  color: ColorMode;
}

export function runWatch(o: WatchOptions): void {
  const out = process.stdout;
  const interactive = Boolean(process.stdin.isTTY);
  const height = () => Math.max(1, (out.rows ?? 40) - 4);
  const selectable = (rows: Row[]) => rows.flatMap((r, i) => (r.key ? [i] : []));
  /** 選択していた行が消えたら、優先度の一番高い行（なければ先頭） */
  const fallback = (rows: Row[]) =>
    selectable(rows).reduce((best, j) => ((rows[j].priority ?? 0) > (rows[best]?.priority ?? 0) ? j : best), selectable(rows)[0] ?? -1);

  const draw = () => {
    const rows = o.rows();
    const v = o.view();
    let idx = rows.findIndex((r) => r.key !== undefined && r.key === v.cursor);
    if (idx < 0) idx = fallback(rows);
    const cursor = rows[idx]?.key ?? null;
    if (cursor !== v.cursor) return o.select(cursor); // 状態が変われば描き直される
    const h = height();
    const top = Math.max(0, Math.min(idx >= 0 ? Math.min(Math.max(v.top, idx - h + 1), idx) : v.top, rows.length - h));
    if (top !== v.top) return o.scroll(top);

    const width = out.columns ?? 120;
    const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
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
    const pos = sel.indexOf(rows.findIndex((r) => r.key === o.view().cursor));
    o.select(rows[sel[Math.max(0, Math.min(sel.length - 1, pos + delta))]]?.key ?? null);
  };
  const enter = () => {
    const target = o.rows().find((r) => r.key === o.view().cursor)?.target;
    if (target && o.visit(target) && o.exitOnVisit) quit();
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
  // 変化が続いても描画は 1 フレームにまとめる
  let pending = false;
  o.subscribe(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      draw();
    }, 30);
  });
  draw();
}
