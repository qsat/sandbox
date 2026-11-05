import { div, type Color, type Context } from "gpui-kit";
import { SELECTED_BG } from "./colors";

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
