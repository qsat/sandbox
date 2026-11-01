// agent-board: Herdr app の mod。エージェント一覧を描き、操作はすべて exec("ws", …) に委ねる。
//
// - mod の JavaScript は Node ではない（gpui-kit のネイティブ UI）。HTML / CSS / Node API / setTimeout は使えない
// - 移動先の判断は ws にだけある。ここは「表示と入力」だけ
// - エージェントの状態は terminals() で即時反映。tmux のセッション・ペインは core に載らないので、
//   表示中だけ数秒おきに ws list --json を取り直す
//
// 構成:
//   [1] 純粋なロジック（boardRows / commandFor）… bun test で検査（mod/agent-board/main.test.js）
//   [2] アダプタ（herdr / gpui-kit の API を使う部分）… 型定義 herdr.d.ts / gpui-kit.d.ts が正。
//       ~/.config/herdr-app/ の型定義に合わせて、ここだけ直せばよいように分けてある。

import { terminals, exec, shared, setShared } from "herdr";
import * as ui from "gpui-kit";

const WS = "ws";
const REFRESH_MS = 4000;

// ===========================================================================
// [1] 純粋なロジック
// ===========================================================================

const ICON = { blocked: "▲", error: "✖", idle: "○", working: "●", done: "✔", unknown: "?" };
const RANK = { blocked: 0, error: 2, idle: 3, working: 4, done: 5, unknown: 6 };

function basename(p) {
  const t = String(p).replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1);
}

function rankOf(a) {
  if (a.status === "blocked") return 0;
  if (a.needsResume) return 1;
  return RANK[a.status] ?? 6;
}

/**
 * ws list --json の木に terminals() の即時の状態を重ね、画面の行に平らにする。
 * @param tree      ws list --json の結果（{workspaces: [...]}）
 * @param live      terminals() の結果（address と status を持つ配列）
 * @param collapsed 折り畳んだ workspace のパスの配列
 */
export function boardRows(tree, live, collapsed) {
  const liveBy = new Map();
  for (const t of live || []) {
    if (!t || !t.address) continue;
    const st = t.status && typeof t.status === "object" ? t.status : { state: t.status };
    liveBy.set(t.address, { status: st.state, kind: st.kind });
  }
  const folded = new Set(collapsed || []);
  const rows = [];
  for (const ws of (tree && tree.workspaces) || []) {
    const worktrees = ws.worktrees.map((wt) => ({
      ...wt,
      agents: wt.agents
        .map((a) => {
          const l = liveBy.get(a.address);
          return l && l.status ? { ...a, status: l.status, kind: l.kind ?? a.kind } : a;
        })
        .sort((x, y) => rankOf(x) - rankOf(y) || x.name.localeCompare(y.name)),
    }));
    const waiting = worktrees.reduce((n, wt) => n + wt.agents.filter((a) => a.status === "blocked" || a.needsResume).length, 0);
    rows.push({ kind: "workspace", key: ws.path, label: ws.name, waiting, collapsed: folded.has(ws.path) });
    if (folded.has(ws.path)) continue;
    for (const wt of worktrees) {
      const tags = [];
      if (wt.branch) tags.push(wt.branch);
      if (wt.session) tags.push(wt.session.attached ? "tmux*" : "tmux");
      if (!wt.exists) tags.push("場所消失");
      rows.push({ kind: "worktree", key: wt.path, label: basename(wt.path), tags, isMain: wt.isMain, exists: wt.exists });
      for (const a of wt.agents) {
        const tagsA = [];
        if (a.needsResume) tagsA.push("要再開");
        if (!a.attached) tagsA.push("未attach");
        if (a.missingLocation) tagsA.push("場所消失");
        if (a.parent) tagsA.push(`子:${a.parent}`);
        rows.push({
          kind: "agent",
          key: a.address,
          label: `${a.address} ${a.name}`,
          icon: ICON[a.status] || "?",
          status: a.status === "blocked" && a.kind ? `blocked(${a.kind})` : a.status,
          rawStatus: a.status,
          tags: tagsA,
          canResume: !!a.needsResume,
          worktree: wt.path,
        });
      }
    }
  }
  return rows;
}

/** 行の操作 → ws の呼び出し（[コマンド, 引数]） */
export function commandFor(row, action) {
  if (row.kind === "workspace") return null;
  switch (action) {
    case "go":
      return [WS, ["go", row.key, "--from-app"]];
    case "new":
      return [WS, ["new", row.kind === "worktree" ? row.key : row.worktree, "--attach", "--from-app"]];
    case "resume":
      return row.kind === "agent" && row.canResume ? [WS, ["resume", row.key]] : null;
    default:
      return null;
  }
}

export function toggleCollapsed(collapsed, key) {
  const s = new Set(collapsed || []);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  return [...s];
}

export function parseList(stdout) {
  try {
    const v = JSON.parse(stdout);
    return v && Array.isArray(v.workspaces) ? v : { workspaces: [] };
  } catch {
    return { workspaces: [] };
  }
}

// ===========================================================================
// [2] アダプタ（herdr / gpui-kit）
//     ここは型定義 herdr.d.ts / gpui-kit.d.ts に合わせて調整する前提。
//     使っている API: terminals() / exec(cmd, args, {cwd}) / shared / setShared / cx のタイマー
// ===========================================================================

let tree = { workspaces: [] };
let lastError = "";
let lastFetch = 0;
let fetching = false;

async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const r = await exec(WS, ["list", "--json"], {});
    tree = parseList(r.stdout ?? r);
    lastError = r.code && r.code !== 0 ? (r.stderr || `ws list: exit ${r.code}`).trim() : "";
  } catch (e) {
    lastError = String((e && e.message) || e);
  } finally {
    lastFetch = Date.now();
    fetching = false;
  }
}

async function runRow(row, action, cx) {
  const c = commandFor(row, action);
  if (!c) return;
  try {
    const r = await exec(c[0], c[1], {});
    lastError = r && r.code && r.code !== 0 ? (r.stderr || "").trim() : "";
  } catch (e) {
    lastError = String((e && e.message) || e);
  }
  await refresh();
  cx && cx.notify && cx.notify();
}

function collapsedState() {
  return (shared && shared.collapsed) || [];
}

function statusColor(status) {
  return { blocked: "warning", error: "danger", idle: "accent", working: "success", done: "muted" }[status] || "muted";
}

function renderRow(row, cx) {
  if (row.kind === "workspace") {
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
  }
  if (row.kind === "worktree") {
    return ui
      .div()
      .flex()
      .gap(6)
      .pl(12)
      .cursor_pointer()
      .on_click(() => runRow(row, "go", cx))
      .child(ui.text(row.label).bold(row.isMain))
      .child(ui.text(row.tags.join(" ")).color("muted"))
      .child(ui.div().flex_grow())
      .child(row.exists ? ui.button("新規").small().on_click(() => runRow(row, "new", cx)) : ui.div());
  }
  return ui
    .div()
    .flex()
    .gap(6)
    .pl(24)
    .cursor_pointer()
    .on_click(() => runRow(row, "go", cx))
    .child(ui.text(row.icon).color(statusColor(row.rawStatus)))
    .child(ui.text(row.label))
    .child(ui.text(row.status).color(statusColor(row.rawStatus)))
    .child(ui.text(row.tags.join(" ")).color("muted"))
    .child(ui.div().flex_grow())
    .child(row.canResume ? ui.button("再開").small().on_click(() => runRow(row, "resume", cx)) : ui.div());
}

/** mod 本体。表示のたびに呼ばれる */
export default function render(cx) {
  // 表示中だけ数秒おきに ws list を取り直す（非表示でもタイマーは動くので控えめに）
  if (Date.now() - lastFetch > REFRESH_MS && !fetching) {
    refresh().then(() => cx && cx.notify && cx.notify());
  }
  if (cx && cx.timer && !render._timer) {
    render._timer = cx.timer(REFRESH_MS, () => cx.notify && cx.notify());
  }
  const rows = boardRows(tree, terminals(), collapsedState());
  const list = ui.div().flex_col().gap(2).p(8);
  if (rows.length === 0) list.child(ui.text("エージェントもセッションもありません").color("muted"));
  for (const r of rows) list.child(renderRow(r, cx));
  if (lastError) list.child(ui.text(lastError).color("danger"));
  return ui.scroll ? ui.scroll(list) : list;
}
