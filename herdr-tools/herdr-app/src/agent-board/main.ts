import { View, div, svg, type AsyncContext, type Color, type Context, type Element } from "gpui-kit";
import { exec, setShared, shared, terminals, theme } from "herdr";
import type { Tag } from "@herdr-tools/utils/tag";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { boardRows, parseList, toggleCollapsed, WS, wsCommandFor, type BoardAction, type BoardRow, type LiveTerminal } from "./board";

const LIST_REFRESH_MS = 4000;
const COLLAPSED_KEY = "agent-board.collapsed";
const ROW_HEIGHT = 22;
const REPOSITORY_SPACING = ROW_HEIGHT * 0.5;
const REPOSITORY_COLOR: Color = "#b8ff3cb3";

type Theme = Record<
  "foreground" | "muted" | "dim" | "accent" | "raised" | "hover" | "solid" | "solid_foreground" | "background" | "blocked" | "unknown" | "ansi1",
  Color
>;

type AgentRow = Extract<BoardRow, { kind: "agent" }>;

type ButtonLook = "secondary" | "primary" | "quiet" | "danger";

interface ButtonSpec {
  id: string;
  icon?: "plus" | "play" | "square" | "x";
  text: string;
  tooltip: string;
  look: ButtonLook;
}

function collapsedState() {
  return (shared(COLLAPSED_KEY) as string[] | undefined) ?? [];
}

function liveTerminals(): LiveTerminal[] {
  return terminals().map((t) => ({
    address: t.address,
    status: typeof t.status === "string" ? { state: t.status, kind: t.report?.kind ?? null } : null,
  }));
}

function statusColor(t: Theme, status: string) {
  return status === "error" ? t.ansi1 : ((t as Record<string, Color>)[status] ?? t.unknown);
}

function toneColor(t: Theme, tone: Tag["tone"]) {
  return { strong: t.accent, muted: t.muted, danger: t.ansi1 }[tone];
}

function label(text: string, color: Color) {
  return div().text_color(color).child(text);
}

function styled(el: Element, look: ButtonLook, t: Theme) {
  switch (look) {
    case "primary":
      return el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88));
    case "secondary":
      return el.bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover));
    case "quiet":
      return el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.ansi1));
    case "danger":
      return el.bg(t.ansi1).text_color(t.background).hover((s) => s.opacity(0.88));
  }
}

function button(spec: ButtonSpec, t: Theme, onClick: (cx: Context) => void) {
  const base = div()
    .id(spec.id)
    .flex()
    .flex_none()
    .items_center()
    .gap(4)
    .h(ROW_HEIGHT - 2)
    .px(8)
    .rounded(6)
    .text_size(12)
    .cursor_pointer()
    .tooltip(spec.tooltip)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .when(spec.icon !== undefined, (el) => el.child(svg(`mods/agent-board/${spec.icon}.svg`).size(12)))
    .child(spec.text);
  return styled(base, spec.look, t);
}

export default class AgentBoard extends View {
  list!: ListedTree;
  error!: string;
  fetching!: boolean;

  init(_props: unknown, cx: AsyncContext) {
    this.list = { workspaces: [] };
    this.error = "";
    this.fetching = false;
    cx.timer.every(LIST_REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx: Context) {
    if (this.fetching) return;
    this.fetching = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(WS, ["list", "--json"]);
        this.list = parseList(r.stdout);
        this.error = r.code !== 0 ? (r.stderr || `ws list: exit ${r.code}`).trim() : "";
      } catch (e) {
        this.error = String((e as Error)?.message ?? e);
      } finally {
        this.fetching = false;
      }
      cx.notify();
    }, { owner: this });
  }

  runRow(row: BoardRow, action: BoardAction, cx: Context) {
    const command = wsCommandFor(row, action);
    if (!command) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(command[0], command[1]);
        this.error = r.code !== 0 ? r.stderr.trim() : "";
      } catch (e) {
        this.error = String((e as Error)?.message ?? e);
      }
      this.refresh(cx);
    }, { owner: this });
  }

  confirmStop(row: AgentRow, t: Theme) {
    const question = row.alive
      ? { title: `${row.label} を停止しますか？`, body: "claude を終了し、一覧から消します。", icon: "square" as const, action: "停止する" }
      : { title: `${row.label} を一覧から消しますか？`, body: "終了したエージェントの記録を herdr-core から消します。", icon: "x" as const, action: "消す" };
    window.open_dialog(
      () =>
        div()
          .flex()
          .flex_col()
          .gap(12)
          .w(320)
          .p(16)
          .rounded(10)
          .bg(t.background)
          .text_size(13)
          .text_color(t.foreground)
          .child(div().font_semibold().child(question.title))
          .child(label(question.body, t.muted))
          .child(
            div()
              .flex()
              .justify_end()
              .gap(8)
              .child(button({ id: "stop-dialog:cancel", text: "キャンセル", tooltip: "何もせずに閉じる", look: "secondary" }, t, () => window.close_dialog()))
              .child(
                button({ id: "stop-dialog:confirm", icon: question.icon, text: question.action, tooltip: question.body, look: "danger" }, t, (cx) => {
                  window.close_dialog();
                  this.runRow(row, "stop", cx);
                }),
              ),
          ),
      { escape_dismissable: true, backdrop_dismissable: true },
    );
  }

  stopButton(row: AgentRow, t: Theme) {
    const spec: ButtonSpec = row.alive
      ? { id: `stop:${row.key}`, icon: "square", text: "停止", tooltip: "claude を終了し、一覧から消す", look: "quiet" }
      : { id: `stop:${row.key}`, icon: "x", text: "消す", tooltip: "終了したエージェントを一覧から消す", look: "quiet" };
    return button(spec, t, () => this.confirmStop(row, t));
  }

  tags(tags: Tag[], t: Theme) {
    return div().flex().gap(4).children(tags.map((tag) => label(tag.text, toneColor(t, tag.tone))));
  }

  info(children: Element[]) {
    return div().flex().flex_1().min_w(0).items_center().gap(6).overflow_hidden().whitespace_nowrap().children(children);
  }

  renderRow(row: BoardRow, t: Theme, first: boolean): Element {
    const base = div().id(`${row.kind}:${row.key}`).flex().items_center().gap(6).min_h(ROW_HEIGHT).px(4).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover));
    switch (row.kind) {
      case "workspace":
        return base
          .when(!first, (el) => el.mt(REPOSITORY_SPACING))
          .on_click(() => setShared(COLLAPSED_KEY, toggleCollapsed(collapsedState(), row.key)))
          .child(label(row.collapsed ? "▸" : "▾", t.muted))
          .child(div().font_semibold().text_color(REPOSITORY_COLOR).child(row.label))
          .when(row.waiting > 0, (el) => el.child(label(`待ち ${row.waiting}`, t.blocked)));
      case "worktree":
        return base
          .pl(16)
          .on_click((_e, cx) => this.runRow(row, "go", cx))
          .child(this.info([div().when(row.isMain, (el) => el.font_semibold()).child(row.label), this.tags(row.tags, t)]))
          .when(row.exists, (el) =>
            el.child(
              button({ id: `new:${row.key}`, icon: "plus", text: "claude", tooltip: "この worktree で claude を起動する", look: "secondary" }, t, (cx) =>
                this.runRow(row, "new", cx),
              ),
            ),
          );
      case "agent": {
        const color = statusColor(t, row.rawStatus);
        return base
          .pl(28)
          .on_click((_e, cx) => this.runRow(row, "go", cx))
          .child(this.info([div().child(row.label), label(row.icon, color), label(row.status, color), this.tags(row.tags, t)]))
          .when(row.canResume, (el) =>
            el.child(
              button({ id: `resume:${row.key}`, icon: "play", text: "再開", tooltip: "claude --resume で会話を再開する", look: "primary" }, t, (cx) =>
                this.runRow(row, "resume", cx),
              ),
            ),
          )
          .child(this.stopButton(row, t));
      }
    }
  }

  render() {
    const t = theme() as unknown as Theme;
    const rows = boardRows(this.list, liveTerminals(), collapsedState());
    return div()
      .id("agent-board")
      .size_full()
      .flex()
      .flex_col()
      .line_height(1.25)
      .p(8)
      .text_size(13)
      .text_color(t.foreground)
      .overflow_y_scrollbar()
      .when(rows.length === 0, (el) => el.child(label("エージェントもセッションもありません", t.muted)))
      .children(rows.map((r, i) => this.renderRow(r, t, i === 0)))
      .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1)));
  }
}
