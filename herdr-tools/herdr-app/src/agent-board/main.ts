import { View, div, svg, type AsyncContext, type Color, type Context, type Element, type FocusHandle } from "gpui-kit";
import { closeOverlay, exec, home, nextCommand, openOverlay, props, readTextFile, run, setShared, shared, terminals, theme, window, writeTextFile } from "herdr";
import { attentionChanges } from "./notify/attention";
import { notifyAgent } from "./notify/notifier";
import { COLLAPSED_KEY, readReveal, REVEAL_KEY } from "../shared/board-reveal";
import { ROW_HEIGHT, label, type Theme as RowTheme } from "../shared/row-view";
import { execWs } from "../shared/ws-exec";
import { BRANCH_COLOR, REPOSITORY_COLOR, SELECTED_BG } from "../shared/colors";
import { TITLE_BAR_HEIGHT } from "../shared/title-bar";
import { watchTmuxFocus } from "../shared/tmux-focus";
import type { Tag } from "@herdr-tools/utils/tag";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { usageSegments } from "@herdr-tools/utils/usage-segments";
import { boardRows, changeTargets, EMPTY_LIST, nextList, parseChanges, type ChangeAmount, keyActionFor, moveSelection, rowId, toggleCollapsed, wsArgsFor, type BoardAction, type BoardRow, type LiveTerminal, wsArgsForModCommand } from "./board";

const MOD_NAME = "agent-board";
const LIST_REFRESH_MS = 2000;
/** 変更量（ws changes）の読み直しの間隔。worktree ごとに git を何度か呼ぶので、一覧（2 秒）より長くする */
const CHANGES_REFRESH_MS = 10000;
const CONFIRM_DIALOG_WIDTH = 360;
const CONFIRM_DIALOG_HEIGHT = 160;
const REPOSITORY_SPACING = ROW_HEIGHT * 0.5;
const CURRENT_PANE_BG: Color = "#e6ff0014";
const PIE_SIZE = 12;

type Theme = RowTheme & Record<"solid" | "solid_foreground" | "popover" | "unknown", Color>;

type AgentRow = Extract<BoardRow, { kind: "agent" }>;
type WorktreeRow = Extract<BoardRow, { kind: "worktree" }>;

type ButtonLook = "secondary" | "outline" | "primary" | "quiet" | "plain" | "alert" | "danger";

interface ConfirmRequest {
  title: string;
  body: string;
  busy: string;
  icon: ButtonSpec["icon"];
  action: string;
  /** ws の引数 */
  args: string[];
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
    case "plain":
      return el.text_color(t.foreground).hover((s) => s.bg(t.hover));
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
  changes!: Record<string, ChangeAmount>;
  changeTargets!: string;
  fetchingChanges!: boolean;
  /** エージェントごとの前回の status（macOS の通知を出すかの判断に使う）。null は、まだ一度も見ていない */
  lastStatuses!: Map<string, string> | null;
  /** workspace-picker からの「この worktree の行を選んで」をこなした印（頼みの時刻） */
  revealedAt!: number;

  init(_props: unknown, cx: AsyncContext) {
    this.lastStatuses = null;
    // 読み込む前に出ていた頼みは、もうこなしたものとみなす（入れ直すたびに選び直さない）
    this.revealedAt = readReveal(shared(REVEAL_KEY))?.at ?? 0;
    this.list = EMPTY_LIST;
    this.error = "";
    this.fetching = false;
    this.confirmRequest = (props()?.confirm as ConfirmRequest | undefined) ?? null;
    this.confirming = false;
    this.selected = null;
    this.changes = {};
    this.changeTargets = "";
    this.fetchingChanges = false;
    this.focus = cx.focus_handle();
    if (this.confirmRequest) {
      this.focus.focus();
      return;
    }
    cx.timer.every(LIST_REFRESH_MS, (cx) => this.refresh(cx));
    cx.timer.every(CHANGES_REFRESH_MS, (cx) => this.refreshChanges(cx));
    this.refresh(cx);
    this.listenForKeyCommands(cx);
    // tmux の hook が今いるペインの変化を知らせたら、2 秒を待たずに読み直す（見張れなくても 2 秒ごとの読み直しで動く）
    watchTmuxFocus(cx, this, (cx) => this.refresh(cx));
  }

  listenForKeyCommands(cx: Context) {
    cx.spawn(async (cx) => {
      for (;;) {
        const args = wsArgsForModCommand(await nextCommand());
        if (!args) continue;
        // 候補が無いとき、ws next --from-app は終了コード 0 で理由を標準エラーに出す
        const r = await execWs(args);
        this.error = r.error || r.stderr.trim();
        this.refresh(cx);
      }
    }, { owner: this });
  }

  refresh(cx: Context) {
    if (this.fetching) return;
    this.fetching = true;
    cx.spawn(async (cx) => {
      const r = await execWs(["list", "--json"]);
      const next = nextList(this.list, r);
      this.list = next.list;
      this.error = next.error;
      this.fetching = false;
      if (r.ok) this.notifyAttention();
      cx.notify();
      // 並ぶ worktree が変わったら、10 秒を待たずに変更量を読む
      if (changeTargets(this.list).join("\n") !== this.changeTargets) this.refreshChanges(cx);
    }, { owner: this });
  }

  /**
   * エージェントが blocked（ユーザーを待っている）か done（見ていない間に終わった）に変わったら、macOS の通知を出す。
   * terminal-notifier があれば、通知のクリックでその会話（tmux のペイン）へ移る。無ければ osascript で出す（クリックしても移らない）。
   * Herdr app のウィンドウが前にあるときは、Herdr app が自分で出すトーストに任せて出さない。
   * 畳んだ workspace のエージェントも対象にするため、畳んだ状態は渡さない。通知の失敗は一覧に出さない
   */
  notifyAttention() {
    const { changed, next } = attentionChanges(this.lastStatuses, boardRows(this.list, liveTerminals(), []));
    this.lastStatuses = next;
    if (window().active) return;
    const io = { home: home(), exec, readTextFile, writeTextFile };
    for (const change of changed) void notifyAgent(change, this.list, io);
  }

  /** worktree ごとの変更量を ws changes --json で読む。失敗しても一覧は壊さない（前の値のまま） */
  refreshChanges(cx: Context) {
    if (this.fetchingChanges) return;
    const targets = changeTargets(this.list);
    this.changeTargets = targets.join("\n");
    if (targets.length === 0) {
      this.changes = {};
      return;
    }
    this.fetchingChanges = true;
    cx.spawn(async (cx) => {
      const r = await execWs(["changes", "--json", ...targets]);
      this.fetchingChanges = false;
      if (!r.ok) return;
      const next = parseChanges(r.stdout);
      if (JSON.stringify(next) === JSON.stringify(this.changes)) return;
      this.changes = next;
      cx.notify();
    }, { owner: this });
  }

  /** worktree の行の変更量（+足した行 −消した行）。変更が無ければ出さない */
  changeAmount(row: WorktreeRow, t: Theme) {
    const a = this.changes[row.key];
    if (!a) return [];
    return [
      div()
        .id(`changes:${row.key}`)
        .flex()
        .flex_none()
        .gap(4)
        .text_size(11)
        .tooltip("ベースブランチから分かれた点と作業ツリーの差（未コミット・新しいファイルも含む）")
        .when(a.added > 0, (el) => el.child(label(`+${a.added}`, t.ansi2)))
        .when(a.deleted > 0, (el) => el.child(label(`−${a.deleted}`, t.ansi1))),
    ];
  }

  runRow(row: BoardRow, action: BoardAction, cx: Context) {
    const args = wsArgsFor(row, action);
    if (!args) return;
    cx.spawn(async (cx) => {
      this.error = (await execWs(args)).error;
      this.refresh(cx);
    }, { owner: this });
  }

  /** 行をクリックして移る。クリックで操作したので、j / k の選択（カーソル）は消す */
  clickRow(row: BoardRow, cx: Context) {
    this.selected = null;
    this.runRow(row, "go", cx);
  }

  askConfirm(request: ConfirmRequest) {
    openOverlay({ mod: MOD_NAME, kind: "dialog", width: CONFIRM_DIALOG_WIDTH, height: CONFIRM_DIALOG_HEIGHT, props: { confirm: request } });
  }

  stopRequest(row: AgentRow): ConfirmRequest {
    const args = wsArgsFor(row, "stop")!;
    return row.alive
      ? { title: `${row.label} を停止しますか？`, body: "claude を終了し、一覧から消します。", busy: "止めています…", icon: "square", action: "停止する", args }
      : { title: `${row.label} を削除しますか？`, body: "終了したエージェントを herdr-core の一覧から削除します。", busy: "削除しています…", icon: "x", action: "削除する", args };
  }

  closeSessionRequest(row: WorktreeRow): ConfirmRequest {
    return {
      title: `${row.label} の tmux セッションを閉じますか？`,
      body: "セッションの中のペインもすべて閉じます。エージェントは herdr-core で動き続けます。",
      busy: "閉じています…",
      icon: "x",
      action: "閉じる",
      args: wsArgsFor(row, "close")!,
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
          .on_click((_e, cx) => this.clickRow(row, cx))
          .child(
            this.info([
              div().text_color(row.hasSession ? BRANCH_COLOR : t.dim).when(row.isMain, (el) => el.font_semibold()).child(row.label),
              this.tags(row.tags, t),
              ...this.changeAmount(row, t),
            ]),
          )
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
          .on_click((_e, cx) => this.clickRow(row, cx))
          .child(this.info([div().text_color(t.muted).child(row.label)]));
      case "agent": {
        const color = statusColor(t, row.rawStatus);
        return base
          .pl(28)
          .on_click((_e, cx) => this.clickRow(row, cx))
          .child(this.info([div().child(row.label), label(row.icon, color), ...(row.status ? [label(row.status, color)] : []), ...this.contextPie(row, t), this.tags(row.tags, t)]))
          .when(row.canResume, (el) =>
            el.child(
              button({ id: `resume:${row.key}`, icon: "play", tooltip: "再開: claude --resume で会話を再開する（R）", look: "plain" }, t, (cx) =>
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
        const r = await execWs(request.args);
        if (r.ok) return closeOverlay(props().overlay);
        this.confirming = false;
        this.error = r.error;
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

  /** commit-history mod と同じ形の題名の帯。右端に Claude の利用上限（円グラフと残り時間）を出す */
  renderTitleBar(t: Theme) {
    return div()
      .flex()
      .flex_none()
      .items_center()
      .gap(8)
      .h(TITLE_BAR_HEIGHT)
      .px(14)
      .border_b(1)
      .border_color(t.border)
      .child(div().font_semibold().child("Worktrees"))
      .child(
        button({ id: "open-workspace-picker", icon: "plus", tooltip: "workspace を選んで claude を起動する（ctrl-e）", look: "plain" }, t, () =>
          run("mod.open", { name: "workspace-picker" }),
        ),
      )
      .child(div().flex_1())
      .child(this.renderUsage(t));
  }

  renderUsage(t: Theme) {
    const segments = usageSegments(this.list.usage, Math.floor(Date.now() / 1000));
    return div()
      .flex()
      .gap(12)
      .items_center()
      .text_size(12)
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

  /**
   * 描く前に、選択（カーソル）を今の状況に合わせる。gpui-kit にはフォーカスが外れたイベントも共有値が変わったイベントも無いので、
   * 描くたびに確かめる（2 秒ごとの読み直しと、setShared による全 mod の描き直しで呼ばれる）
   */
  syncSelection() {
    // キーボードがボードに無い（ほかのペインへ移った、Herdr app が後ろに回った）なら、j / k の選択を消す
    if (this.selected !== null && !(this.focus.is_focused() && window().active)) this.selected = null;
    this.consumeReveal();
  }

  /** workspace-picker が「この worktree の行を選んで」と頼んでいたら、その行を選び、キーボードをボードに移す。同じ頼みは一度だけこなす */
  consumeReveal() {
    const reveal = readReveal(shared(REVEAL_KEY));
    if (!reveal || reveal.at === this.revealedAt) return;
    this.revealedAt = reveal.at;
    this.selected = rowId({ kind: "worktree", key: reveal.path } as BoardRow);
    this.focus.focus();
  }

  render() {
    const t = theme() as unknown as Theme;
    if (this.confirmRequest) return this.renderConfirmDialog(this.confirmRequest, t);
    const rows = boardRows(this.list, liveTerminals(), collapsedState());
    this.syncSelection();
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
      .text_size(13)
      .text_color(t.foreground)
      .child(this.renderTitleBar(t))
      .child(
        div()
          .id("agent-board:list")
          .flex()
          .flex_col()
          .flex_1()
          .min_h(0)
          .p(8)
          .overflow_y_scrollbar()
          .when(rows.length === 0, (el) => el.child(label("エージェントもセッションもありません", t.muted)))
          .children(rows.map((r, i) => this.renderRow(r, t, i === 0, rowId(r) === this.selected)))
          .when(this.error !== "", (el) => el.child(label(this.error, t.ansi1))),
      );
  }
}
