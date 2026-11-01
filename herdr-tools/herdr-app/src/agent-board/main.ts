// agent-board: Herdr app の mod 本体（アダプタ）。エージェント一覧を描き、操作はすべて exec("ws", …) に委ねる。
//
// - mod の JavaScript は Node ではない（gpui-kit のネイティブ UI）。HTML / CSS / Node API / setTimeout は使えない。
//   bun build で board.ts と utils をまとめた1ファイル（main.js）にし、herdr / gpui-kit だけを外部 import として残す
// - 移動先の判断は ws にだけある。ここは「表示と入力」だけ
// - エージェントの状態は terminals() で即時反映。tmux のセッション・ペインは core に載らないので、
//   表示中だけ数秒おきに ws list --json を取り直す
//
// ここで使う herdr / gpui-kit の API は、~/.config/herdr-app/ の herdr.d.ts / gpui-kit.d.ts が正。
// 手元の型定義に合わせて直すのはこのファイルだけ（判断ロジックは board.ts でテスト済み）。

import { exec, setShared, shared, terminals } from "herdr";
import * as ui from "gpui-kit";
import type { Tag } from "@herdr-tools/utils/tag";
import { boardRows, commandFor, parseList, toggleCollapsed, WS, type BoardAction, type BoardRow, type ListedTree } from "./board";

const REFRESH_MS = 4000;

let tree: ListedTree = { workspaces: [] };
let lastError = "";
let lastFetch = 0;
let fetching = false;
let timer: unknown;

async function refresh(): Promise<void> {
  if (fetching) return;
  fetching = true;
  try {
    const r = await exec(WS, ["list", "--json"], {});
    tree = parseList(r.stdout);
    lastError = r.code !== 0 ? (r.stderr || `ws list: exit ${r.code}`).trim() : "";
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
  } finally {
    lastFetch = Date.now();
    fetching = false;
  }
}

async function runRow(row: BoardRow, action: BoardAction, cx: ui.Context): Promise<void> {
  const c = commandFor(row, action);
  if (!c) return;
  try {
    const r = await exec(c[0], c[1], {});
    lastError = r.code !== 0 ? (r.stderr || "").trim() : "";
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
  }
  await refresh();
  cx.notify();
}

function collapsedState(): string[] {
  return (shared?.collapsed as string[] | undefined) ?? [];
}

const STATUS_COLOR: Record<string, string> = { blocked: "warning", error: "danger", idle: "accent", working: "success" };
const TONE_COLOR: Record<Tag["tone"], string> = { strong: "warning", muted: "muted", danger: "danger" };

function tagsView(tags: Tag[]) {
  const row = ui.div().flex().gap(4);
  for (const t of tags) row.child(ui.text(t.text).color(TONE_COLOR[t.tone]));
  return row;
}

function renderRow(row: BoardRow, cx: ui.Context) {
  switch (row.kind) {
    case "workspace":
      return ui
        .div()
        .flex()
        .gap(6)
        .py(4)
        .cursor_pointer()
        .on_click(() => setShared({ collapsed: toggleCollapsed(collapsedState(), row.key) }))
        .child(ui.text(row.collapsed ? "▸" : "▾"))
        .child(ui.text(row.label).bold())
        .child(row.waiting ? ui.text(`待ち ${row.waiting}`).color("warning") : ui.div());
    case "worktree":
      return ui
        .div()
        .flex()
        .gap(6)
        .pl(12)
        .cursor_pointer()
        .on_click(() => runRow(row, "go", cx))
        .child(ui.text(row.label).bold(row.isMain))
        .child(tagsView(row.tags))
        .child(ui.div().flex_grow())
        .child(row.exists ? ui.button("新規").small().on_click(() => runRow(row, "new", cx)) : ui.div());
    case "agent": {
      const color = STATUS_COLOR[row.rawStatus] ?? "muted";
      return ui
        .div()
        .flex()
        .gap(6)
        .pl(24)
        .cursor_pointer()
        .on_click(() => runRow(row, "go", cx))
        .child(ui.text(row.icon).color(color))
        .child(ui.text(row.label))
        .child(ui.text(row.status).color(color))
        .child(tagsView(row.tags))
        .child(ui.div().flex_grow())
        .child(row.canResume ? ui.button("再開").small().on_click(() => runRow(row, "resume", cx)) : ui.div());
    }
  }
}

/** mod 本体。表示のたびに呼ばれる */
export default function render(cx: ui.Context) {
  // 表示中だけ数秒おきに ws list を取り直す（非表示でもタイマーは動くので控えめに）
  if (Date.now() - lastFetch > REFRESH_MS && !fetching) void refresh().then(() => cx.notify());
  if (!timer && cx.timer) timer = cx.timer(REFRESH_MS, () => cx.notify());

  const list = ui.div().flex_col().gap(2).p(8);
  const rows = boardRows(tree, terminals(), collapsedState());
  if (rows.length === 0) list.child(ui.text("エージェントもセッションもありません").color("muted"));
  for (const r of rows) list.child(renderRow(r, cx));
  if (lastError) list.child(ui.text(lastError).color("danger"));
  return ui.scroll ? ui.scroll(list) : list;
}
