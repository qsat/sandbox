import { View, div, svg, type AsyncContext, type Color, type Context, type Element, type FocusHandle } from "gpui-kit";
import { closeOverlay, exec, nextCommand, openOverlay, props, setShared, shared, terminals, theme } from "herdr";
import type { Tag } from "@herdr-tools/utils/tag";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { usageSegments } from "@herdr-tools/utils/usage-segments";
import { boardRows, EMPTY_LIST, keyActionFor, moveSelection, parseList, rowId, toggleCollapsed, WS, wsCommandFor, type BoardAction, type BoardRow, type LiveTerminal, wsArgsForModCommand } from "./board";

const MOD_NAME = "agent-board";
const LIST_REFRESH_MS = 2000;
const CONFIRM_DIALOG_WIDTH = 360;
const CONFIRM_DIALOG_HEIGHT = 160;
const COLLAPSED_KEY = "agent-board.collapsed";
const ROW_HEIGHT = 22;
const REPOSITORY_SPACING = ROW_HEIGHT * 0.5;
const REPOSITORY_COLOR: Color = "#b8ff3cb3";
const BRANCH_COLOR: Color = "#fff03c80";
const SELECTED_BG: Color = "#e6ff0033";
const CURRENT_PANE_BG: Color = "#e6ff0014";
const PIE_SIZE = 12;

type Theme = Record<
  "foreground" | "muted" | "dim" | "accent" | "raised" | "hover" | "solid" | "solid_foreground" | "background" | "popover" | "blocked" | "unknown" | "ansi1",
  Color
>;

type AgentRow = Extract<BoardRow, { kind: "agent" }>;
type WorktreeRow = Extract<BoardRow, { kind: "worktree" }>;

type ButtonLook = "secondary" | "outline" | "primary" | "quiet" | "alert" | "danger";

interface ConfirmRequest {
  title: string;
  body: string;
  busy: string;
  icon: ButtonSpec["icon"];
  action: string;
  command: [string, string[]];
}

interface ButtonSpec {
  id: string;
  icon?: "plus" | "play" | "square" | "x";
  text?: string;
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

function pieColor(t: Theme, tone: Tag["tone"]) {
  return { strong: t.blocked, muted: t.accent, danger: t.ansi1 }[tone];
}

function pie(usedPercentage: number, fill: Color, t: Theme) {
  return div()
    .flex_none()
    .size(PIE_SIZE)
    .rounded(PIE_SIZE / 2)
    .border_1()
    .border_color(t.dim)
    .when(usedPercentage > 0, (el) => el.child(svg(`mods/agent-board/pie/${usedPercentage}.svg`).size(PIE_SIZE - 2).text_color(fill)));
}

function styled(el: Element, look: ButtonLook, t: Theme) {
  switch (look) {
    case "primary":
      return el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88));
    case "secondary":
      return el.bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover));
    case "quiet":
      return el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.ansi1));
    case "outline":
      return el.h(ROW_HEIGHT - 4).text_size(11).border_1().border_color(t.dim).text_color(t.foreground).hover((s) => s.bg(t.hover));
    case "alert":
      return el.text_color(t.ansi1).hover((s) => s.bg(t.hover));
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
    .px(spec.text === undefined ? 4 : 8)
    .rounded(6)
    .text_size(12)
    .cursor_pointer()
    .tooltip(spec.tooltip)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .when(spec.icon !== undefined, (el) => el.child(svg(`mods/agent-board/${spec.icon}.svg`).size(12)))
    .when(spec.text !== undefined, (el) => el.child(spec.text!));
  return styled(base, spec.look, t);
}

export default class AgentBoard extends View {
  list!: ListedTree;
  error!: string;
  fetching!: boolean;
  confirmRequest!: ConfirmRequest | null;
  confirming!: boolean;
  focus!: FocusHandle;
  selected!: string | null;

  init(_props: unknown, cx: AsyncContext) {
    this.list = EMPTY_LIST;
    this.error = "";
    this.fetching = false;
    this.confirmRequest = (props()?.confirm as ConfirmRequest | undefined) ?? null;
    this.confirming = false;
    this.selected = null;
    this.focus = cx.focus_handle();
    if (this.confirmRequest) {
      this.focus.focus();
      return;
    }
    cx.timer.every(LIST_REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
    this.listenForKeyCommands(cx);
  }

  listenForKeyCommands(cx: Context) {
    cx.spawn(async (cx) => {
      for (;;) {
        const args = wsArgsForModCommand(await nextCommand());
        if (!args) continue;
        try {
          const r = await exec(WS, args);
          this.error = r.code !== 0 || r.stderr.trim() ? (r.stderr.trim() || `ws ${args.join(" ")}: exit ${r.code}`) : "";
        } catch (e) {
          this.error = String((e as Error)?.message ?? e);
        }
        this.refresh(cx);
      }
    }, { owner: this });
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

  askConfirm(request: ConfirmRequest) {
    openOverlay({ mod: MOD_NAME, kind: "dialog", width: CONFIRM_DIALOG_WIDTH, height: CONFIRM_DIALOG_HEIGHT, props: { confirm: request } });
  }

  stopRequest(row: AgentRow): ConfirmRequest {
    const command = wsCommandFor(row, "stop")!;
    return row.alive
      ? { title: `${row.label} を停止しますか？`, body: "claude を終了し、一覧から消します。", busy: "止めています…", icon: "square", action: "停止する", command }
      : { title: `${row.label} を削除しますか？`, body: "終了したエージェントを herdr-core の一覧から削除します。", busy: "削除しています…", icon: "x", action: "削除する", command };
  }

  closeSessionRequest(row: WorktreeRow): ConfirmRequest {
    return {
      title: `${row.label} の tmux セッションを閉じますか？`,
      body: "セッションの中のペインもすべて閉じます。エージェントは herdr-core で動き続けます。",
      busy: "閉じています…",
      icon: "x",
      action: "閉じる",
      command: wsCommandFor(row, "close")!,
    };
  }

  contextPie(row: AgentRow, t: Theme) {
    if (!row.context) return [];
    return [div().id(`context:${row.key}`).flex_none().tooltip(`context ${row.context.used}%`).child(pie(row.context.used, pieColor(t, row.context.tone), t))];
  }

  stopButton(row: AgentRow, t: Theme) {
    const spec: ButtonSpec = row.alive
      ? { id: `stop:${row.key}`, icon: "square", tooltip: "停止: claude を終了し、一覧から消す（s）", look: "alert" }
      : { id: `stop:${row.key}`, icon: "x", text: "削除", tooltip: "終了したエージェントを一覧から削除する（s）", look: "quiet" };
    return button(spec, t, () => this.askConfirm(this.stopRequest(row)));
  }

  closeSessionButton(row: WorktreeRow, t: Theme) {
    return button({ id: `close:${row.key}`, icon: "x", tooltip: "この worktree の tmux セッションを閉じる。エージェントは止めない（x）", look: "quiet" }, t, () =>
      this.askConfirm(this.closeSessionRequest(row)),
    );
  }

  tags(tags: Tag[], t: Theme) {
    return div().flex().gap(4).children(tags.map((tag) => label(tag.text, toneColor(t, tag.tone))));
  }

  info(children: Element[]) {
    return div().flex().flex_1().min_w(0).items_center().gap(6).overflow_hidden().whitespace_nowrap().children(children);
  }

  renderRow(row: BoardRow, t: Theme, first: boolean, selected: boolean): Element {
    const base = div()
      .id(rowId(row))
      .flex()
      .items_center()
      .gap(6)
      .min_h(ROW_HEIGHT)
      .px(4)
      .rounded(6)
      .cursor_pointer()
      .when((row.kind === "agent" || row.kind === "pane") && row.isCurrentPane, (el) => el.bg(CURRENT_PANE_BG))
      .when(selected, (el) => el.bg(SELECTED_BG))
      .hover((s) => s.bg(t.hover));
    switch (row.kind) {
      case "workspace":
        return base
          .when(!first, (el) => el.mt(REPOSITORY_SPACING))
          .on_click(() => setShared(COLLAPSED_KEY, toggleCollapsed(collapsedState(), row.key)))
          .child(label(row.collapsed ? "▸" : "▾", t.muted))
          .child(div().font_semibold().text_color(REPOSITORY_COLOR).child(row.label))
          .when(row.waiting > 0, (el) => el.child(label(`!! ${row.waiting}`, t.blocked)));
      case "worktree":
        return base
          .pl(16)
          .on_click((_e, cx) => this.runRow(row, "go", cx))
          .child(this.info([div().text_color(row.hasSession ? BRANCH_COLOR : t.dim).when(row.isMain, (el) => el.font_semibold()).child(row.label), this.tags(row.tags, t)]))
          .when(row.hasSession, (el) => el.child(this.closeSessionButton(row, t)))
          .when(row.exists, (el) =>
            el.child(
              button({ id: `new:${row.key}`, icon: "plus", text: "claude", tooltip: "この worktree で claude を起動する（n）", look: "outline" }, t, (cx) =>
                this.runRow(row, "new", cx),
              ),
            ),
          );
      case "pane":
        return base
          .pl(28)
          .on_click((_e, cx) => this.runRow(row, "go", cx))
          .child(this.info([div().text_color(t.muted).child(row.label)]));
      case "agent": {
        const color = statusColor(t, row.rawStatus);
        return base
          .pl(28)
          .on_click((_e, cx) => this.runRow(row, "go", cx))
          .child(this.info([div().child(row.label), label(row.icon, color), label(row.status, color), ...this.contextPie(row, t), this.tags(row.tags, t)]))
          .when(row.canResume, (el) =>
            el.child(
              button({ id: `resume:${row.key}`, icon: "play", text: "再開", tooltip: "claude --resume で会話を再開する（R）", look: "primary" }, t, (cx) =>
                this.runRow(row, "resume", cx),
              ),
            ),
          )
          .when(!row.canResume, (el) => el.child(this.stopButton(row, t)));
      }
    }
  }

  runConfirmed(request: ConfirmRequest, cx: Context) {
    if (this.confirming) return;
    this.confirming = true;
    this.error = "";
    cx.notify();
    cx.spawn(
      async (cx) => {
        const r = await exec(...request.command).catch((e: Error) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
        if (r.code === 0) return closeOverlay(props().overlay);
        this.confirming = false;
        this.error = r.stderr.trim() || r.stdout.trim();
        cx.notify();
      },
      { owner: this },
    );
  }

  renderConfirmDialog(request: ConfirmRequest, t: Theme) {
    const large = (el: Element) => el.h(28).px(12);
    return div()
      .id("agent-board-confirm")
      .track_focus(this.focus)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.runConfirmed(request, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .flex()
      .flex_col()
      .gap(12)
      .p(18)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child(request.title))
      .child(div().flex_1().text_color(this.error ? t.ansi1 : t.muted).child(this.error || (this.confirming ? request.busy : request.body)))
      .child(
        div()
          .flex()
          .justify_end()
          .gap(8)
          .child(large(button({ id: "confirm-dialog:cancel", text: "キャンセル", tooltip: "Esc", look: "secondary" }, t, () => closeOverlay(props().overlay))))
          .child(
            large(button({ id: "confirm-dialog:ok", icon: request.icon, text: request.action, tooltip: "Enter", look: "danger" }, t, (cx) => this.runConfirmed(request, cx))),
          ),
      );
  }

  onBoardKey(keystroke: string, rows: BoardRow[], cx: Context) {
    if (keystroke === "j" || keystroke === "down" || keystroke === "k" || keystroke === "up") {
      this.selected = moveSelection(rows, this.selected, keystroke === "j" || keystroke === "down" ? 1 : -1);
      cx.notify();
      return true;
    }
    const hit = keyActionFor(rows, this.selected, keystroke);
    if (!hit) return false;
    if (hit.action === "stop" && hit.row.kind === "agent") this.askConfirm(this.stopRequest(hit.row));
    else if (hit.action === "close" && hit.row.kind === "worktree") this.askConfirm(this.closeSessionRequest(hit.row));
    else this.runRow(hit.row, hit.action, cx);
    return true;
  }

  renderUsage(t: Theme) {
    const segments = usageSegments(this.list.usage, Math.floor(Date.now() / 1000));
    return div()
      .flex()
      .justify_end()
      .gap(12)
      .min_h(segments.length > 0 ? ROW_HEIGHT : 0)
      .items_center()
      .children(
        segments.map((s, i) =>
          div()
            .id(`usage-${i}`)
            .flex()
            .items_center()
            .gap(4)
            .tooltip(`${s.windowName} ${s.used}% 使用`)
            .child(pie(s.used, pieColor(t, s.tone), t))
            .child(label(s.timeLeft, toneColor(t, s.tone))),
        ),
      );
  }

  render() {
    const t = theme() as unknown as Theme;
    if (this.confirmRequest) return this.renderConfirmDialog(this.confirmRequest, t);
    const rows = boardRows(this.list, liveTerminals(), collapsedState());
    return div()
      .id("agent-board")
      .track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => {
        if (this.onBoardKey(e.keystroke, rows, cx)) cx.stop_propagation();
      })
      .size_full()
      .flex()
      .flex_col()
      .line_height(1.25)
      .p(8)
      .text_size(13)
      .text_color(t.foreground)
      .overflow_y_scrollbar()
      .child(this.renderUsage(t))
      .when(rows.length === 0, (el) => el.child(label("エージェントもセッションもありません", t.muted)))
      .children(rows.map((r, i) => this.renderRow(r, t, i === 0, rowId(r) === this.selected)))
      .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1)));
  }
}
