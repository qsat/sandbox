// ghq の workspace（worktree）を fzf のように絞り込んで選び、agent-board に出す popup。
// ボードにもう出ている worktree は agent-board でその行を選ぶだけ、出ていなければ claude を起動してボードに出す。
// ctrl-e（keys.json の layout:agents）か、agent-board の題名の帯の ＋ ボタンで開く。
// 打った文字で絞り込み、ctrl-j / ctrl-k（↓ / ↑）で選び、Enter で決める、Esc で閉じる。
import { View, div, type AsyncContext, type Color, type Context, type FocusHandle } from "gpui-kit";
import { Input, InputState } from "gpui-base";
import { closeOverlay, props, setShared, shared, theme } from "herdr";
import { COLLAPSED_KEY, REVEAL_KEY, unfold } from "../shared/board-reveal";
import { execWs } from "../shared/ws-exec";
import { parseList } from "../shared/ws-list";
import { candidates, filterCandidates, moveCursor, pickAction, shortWorkspace, type Candidate } from "./candidates";

/** 一度に並べる行の数。選んだ行がこの範囲から出たら、範囲をずらす */
const VISIBLE_ROWS = 12;
const ROW_HEIGHT = 30;

type Theme = Record<"foreground" | "muted" | "dim" | "accent" | "background" | "popover" | "hover" | "border" | "ansi1", Color>;

export default class WorkspacePicker extends View {
  items!: Candidate[];
  query!: string;
  at!: number;
  top!: number;
  loading!: boolean;
  launching!: boolean;
  error!: string;
  input!: InputState;
  handle!: FocusHandle;

  init(_props: unknown, cx: AsyncContext) {
    this.items = [];
    this.query = "";
    this.at = 0;
    this.top = 0;
    this.loading = true;
    this.launching = false;
    this.error = "";
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "workspace を絞り込む…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.at = 0;
      this.top = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.pick(this.shown()[this.at], cx));
    this.input.focus();
    cx.spawn(async (cx) => {
      // all は候補、board はボードに出ているかの判定に使う
      const [all, board] = await Promise.all([execWs(["list", "--json", "--all"]), execWs(["list", "--json"])]);
      this.items = candidates(parseList(all.stdout), parseList(board.stdout));
      this.error = all.error || board.error;
      this.loading = false;
      cx.notify();
    }, { owner: this });
  }

  shown() {
    return filterCandidates(this.items, this.query);
  }

  close() {
    closeOverlay(props().overlay);
  }

  /**
   * 選んだ worktree をボードに出す。ボードにあれば、畳んだ workspace を開いて agent-board にその行を選ばせ、閉じる。
   * 無ければ claude を起動して会話へ移る。起動に失敗したら閉じずに理由を出す
   */
  pick(c: Candidate | undefined, cx: Context) {
    if (!c || this.launching) return;
    const action = pickAction(c);
    if (action.kind === "reveal") {
      setShared(COLLAPSED_KEY, unfold((shared(COLLAPSED_KEY) as string[] | undefined) ?? [], action.workspacePath));
      setShared(REVEAL_KEY, { path: action.path, at: Date.now() });
      return this.close();
    }
    this.launching = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await execWs(action.args);
      this.launching = false;
      if (r.ok) return this.close();
      this.error = r.error;
      cx.notify();
    }, { owner: this });
  }

  move(delta: 1 | -1, length: number) {
    this.at = moveCursor(this.at, length, delta);
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + VISIBLE_ROWS) this.top = this.at - VISIBLE_ROWS + 1;
  }

  render() {
    const t = theme() as unknown as Theme;
    const shown = this.shown();
    this.at = Math.min(this.at, Math.max(0, shown.length - 1));
    const visible = shown.slice(this.top, this.top + VISIBLE_ROWS);
    const status = this.loading ? "読み込んでいます…" : this.launching ? "起動しています…" : shown.length === 0 ? "当てはまる workspace がありません" : `${shown.length} 件`;
    return div()
      .id("workspace-picker")
      .track_focus(this.handle)
      .flex()
      .flex_col()
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.keystroke;
        if (k === "escape") return this.close();
        if (k === "ctrl-j" || k === "down") this.move(1, shown.length);
        else if (k === "ctrl-k" || k === "up") this.move(-1, shown.length);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().text_size(15).font_semibold().child("ボードに出す workspace"))
      .child(
        div()
          .flex()
          .items_center()
          .h(36)
          .flex_none()
          .px(10)
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        div()
          .flex()
          .flex_col()
          .children(
            visible.map((c, i) => {
              const selected = this.top + i === this.at;
              return div()
                .id(`wp-${c.path}`)
                .flex()
                .items_center()
                .gap(10)
                .h(ROW_HEIGHT)
                .px(10)
                .rounded(7)
                .cursor_pointer()
                .when(selected, (el) => el.bg(t.hover))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.pick(c, cx))
                // 幅が足りないときは workspace の名前から省略し、worktree の名前と右端の印は残す
                .child(div().flex_none().max_w(170).truncate().font_semibold().child(c.worktree))
                .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(shortWorkspace(c.workspace)))
                .when(c.agents > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`エージェント ${c.agents}`)))
                .when(c.onBoard, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("ボード")));
            }),
          ),
      )
      .child(
        div()
          .flex()
          .gap(12)
          .text_size(11)
          .text_color(t.dim)
          .child(div().flex_1().child(status))
          .child(div().flex_none().child("ctrl-j / ctrl-k で選ぶ　Enter で決める　Esc で閉じる")),
      )
      .when(this.error !== "", (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error)));
  }
}
