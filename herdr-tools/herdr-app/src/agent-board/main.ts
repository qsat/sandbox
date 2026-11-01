import { exec, setShared, shared, terminals } from "herdr";
import * as ui from "gpui-kit";
import type { Tag } from "@herdr-tools/utils/tag";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { boardRows, parseList, toggleCollapsed, WS, wsCommandFor, type BoardAction, type BoardRow } from "./board";

const LIST_REFRESH_MS = 4000;

let listJson: ListedTree = { workspaces: [] };
let lastError = "";
let lastFetch = 0;
let fetching = false;
let timer: unknown;

async function refreshListJson() {
  if (fetching) return;
  fetching = true;
  try {
    const r = await exec(WS, ["list", "--json"], {});
    listJson = parseList(r.stdout);
    lastError = r.code !== 0 ? (r.stderr || `ws list: exit ${r.code}`).trim() : "";
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
  } finally {
    lastFetch = Date.now();
    fetching = false;
  }
}

async function runRow(row: BoardRow, action: BoardAction, cx: ui.Context) {
  const c = wsCommandFor(row, action);
  if (!c) return;
  try {
    const r = await exec(c[0], c[1], {});
    lastError = r.code !== 0 ? (r.stderr || "").trim() : "";
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
  }
  await refreshListJson();
  cx.notify();
}

function collapsedState() {
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

export default function render(cx: ui.Context) {
  if (Date.now() - lastFetch > LIST_REFRESH_MS && !fetching) void refreshListJson().then(() => cx.notify());
  if (!timer && cx.timer) timer = cx.timer(LIST_REFRESH_MS, () => cx.notify());

  const list = ui.div().flex_col().gap(2).p(8);
  const rows = boardRows(listJson, terminals(), collapsedState());
  if (rows.length === 0) list.child(ui.text("エージェントもセッションもありません").color("muted"));
  for (const r of rows) list.child(renderRow(r, cx));
  if (lastError) list.child(ui.text(lastError).color("danger"));
  return ui.scroll ? ui.scroll(list) : list;
}
