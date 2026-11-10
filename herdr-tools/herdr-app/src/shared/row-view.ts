import { div, svg, type Color, type Context } from "gpui-kit";
import { BRANCH_COLOR, REPOSITORY_COLOR, SELECTED_BG } from "./colors";
import type { Target } from "./target";

/** 行の高さ。commit-history と pull-requests で同じにする */
export const ROW_HEIGHT = 22;

export type Theme = Record<"foreground" | "muted" | "dim" | "accent" | "raised" | "hover" | "background" | "border" | "blocked" | "ansi1" | "ansi2", Color>;

export function label(text: string, color: Color) {
  return div().text_color(color).child(text);
}

/** 一覧の 1 行の土台。選んでいる行は背景を塗り、マウスを重ねると背景を変える。indent は左の余白 */
export function rowBase(id: string, selected: boolean, t: Theme, indent: number) {
  return div()
    .id(id)
    .flex()
    .items_center()
    .gap(8)
    .min_h(ROW_HEIGHT)
    .pl(indent)
    .pr(4)
    .rounded(6)
    .cursor_pointer()
    .overflow_hidden()
    .whitespace_nowrap()
    .when(selected, (el) => el.bg(SELECTED_BG))
    .hover((s) => s.bg(t.hover));
}

/** 行の中で押すと hunk を開く文字（ハッシュ・#番号）。マウスを重ねると下線と色を付け、行の開閉は起こさない */
export function hunkLink(id: string, text: string, tooltip: string, t: Theme, onClick: (cx: Context) => void) {
  return div()
    .id(id)
    .flex_none()
    .text_color(t.accent)
    .cursor_pointer()
    .tooltip(tooltip)
    .hover((s) => s.underline().text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(text);
}

/** 行の右端などに置く、アイコンだけのボタン。icon は mod の中の svg のパス（mods/<mod>/<name>.svg） */
export function iconButton(id: string, icon: string, tooltip: string, t: Theme, onClick: (cx: Context) => void) {
  return div()
    .id(id)
    .flex()
    .flex_none()
    .items_center()
    .h(18)
    .px(4)
    .rounded(4)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(tooltip)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(svg(icon).size(12));
}

/** 一覧の上の、今見ている worktree の見出し（workspace 名とブランチ）。右に足すものは呼ぶ側が child で続ける */
export function targetHeader(target: Target, t: Theme) {
  return div()
    .flex()
    .items_center()
    .gap(8)
    .min_h(ROW_HEIGHT)
    .px(4)
    .overflow_hidden()
    .whitespace_nowrap()
    .child(div().font_semibold().text_color(REPOSITORY_COLOR).child(target.workspace))
    .child(div().text_color(BRANCH_COLOR).child(target.label))
    .when(target.branch !== null && target.branch !== target.label, (el) => el.child(label(target.branch!, t.muted)));
}

/** 変更の状態の記号（A・M・D・R・U・?）の色。commit-history と worktree-changes で同じにする */
export function statusColor(t: Theme, status: string) {
  return status === "A" || status === "?" ? t.ansi2 : status === "D" || status === "U" ? t.ansi1 : status === "R" ? t.accent : t.blocked;
}
