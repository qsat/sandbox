/**
 * 常駐表示: 状態が変わるたびに描き直し、j/k で選択、Enter で移動する
 * 何を表示するか・どう移動するかは呼び出し側から関数で受け取る（このモジュールは I/O の中身を知らない）
 */
import type { JumpTarget } from "../domain/model.ts";
import type { ColorMode } from "./terminal.ts";
import { formatRow, paint } from "./terminal.ts";
import type { Cell, Row } from "./view.ts";

export interface WatchOptions {
  rows: () => Row[];
  subscribe: (onChange: () => void) => void; // 表示する状態が変わったら呼ばれる
  jump: (t: JumpTarget) => { ok: boolean; message: Cell };
  reload: () => void; // r キー: リポジトリ構成から読み直す
  exitOnJump: boolean; // display-popup 内で使うとき、移動したら閉じる
  color: ColorMode;
}

export function runWatch(o: WatchOptions): void {
  const out = process.stdout;
  const interactive = Boolean(process.stdin.isTTY);
  let rows: Row[] = [];
  let cursor: string | undefined; // 選択中の行の key
  let top = 0; // スクロール位置
  let message: Cell | undefined;

  const selectable = () => rows.flatMap((r, i) => (r.key ? [i] : []));
  const cursorIndex = () => {
    let i = rows.findIndex((r) => r.key !== undefined && r.key === cursor);
    if (i < 0) {
      // 選択していた行が消えたら、優先度の一番高い行（なければ先頭）を選び直す
      i = selectable().reduce((best, j) => ((rows[j].priority ?? 0) > (rows[best]?.priority ?? 0) ? j : best), selectable()[0] ?? -1);
      cursor = rows[i]?.key;
    }
    return i;
  };

  const draw = () => {
    const width = out.columns ?? 120;
    const height = Math.max(1, (out.rows ?? 40) - 4);
    const idx = cursorIndex();
    if (idx >= 0) top = Math.min(Math.max(top, idx - height + 1), idx);
    top = Math.max(0, Math.min(top, rows.length - height));
    const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
    const help = interactive ? "j/k:選択  Enter:移動  r:更新  q:終了" : "Ctrl-C で終了";
    const body = rows.slice(top, top + height).map((r, i) => {
      if (!interactive) return formatRow(r, width, o.color);
      const mark = top + i === idx ? paint("❯ ", "agent", o.color) : "  ";
      return mark + formatRow(r, width - 2, o.color);
    });
    const footer = message ? ["", formatRow({ prefix: "", cells: [message] }, width, o.color)] : [];
    out.write(`\x1b[H\x1b[2J${[paint(`agent-ws  ${time}  ${help}`, "dim", o.color), "", ...body, ...footer].join("\n")}\n`);
  };

  const refresh = () => {
    rows = o.rows();
    draw();
  };
  const quit = () => {
    if (interactive) process.stdin.setRawMode(false);
    out.write("\x1b[?25h\n");
    process.exit(0);
  };
  const move = (delta: number) => {
    const sel = selectable();
    const pos = sel.indexOf(cursorIndex());
    cursor = rows[sel[Math.max(0, Math.min(sel.length - 1, pos + delta))]]?.key;
    message = undefined;
    draw();
  };
  const enter = () => {
    const target = rows[cursorIndex()]?.target;
    if (!target) return;
    const r = o.jump(target);
    if (r.ok && o.exitOnJump) return quit();
    message = r.message;
    refresh();
  };
  const keys: Record<string, () => void> = {
    j: () => move(1), "\x1b[B": () => move(1),
    k: () => move(-1), "\x1b[A": () => move(-1),
    g: () => move(-Infinity), G: () => move(Infinity),
    r: () => (o.reload(), refresh()),
    "\r": enter,
    q: quit, "\x1b": quit, "\x03": quit,
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
  let pending: Timer | undefined;
  o.subscribe(() => (pending ??= setTimeout(() => ((pending = undefined), refresh()), 30)));
  refresh();
}
