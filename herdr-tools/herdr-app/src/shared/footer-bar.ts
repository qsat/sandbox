import { div, svg, type Context } from "gpui-kit";
import type { Theme } from "./row-view";

/** mod の下端のフッターの高さ */
export const FOOTER_HEIGHT = 30;

/** mod の下端のフッター。commit-history の範囲のボタンと worktree-changes の表示の切り替えのボタンを、右の子として並べる */
export function footerBar(t: Theme) {
  return div().flex().flex_none().items_center().gap(4).h(FOOTER_HEIGHT).px(10).border_t(1).border_color(t.border);
}

/**
 * フッターの切り替えのボタン。選んでいるボタンは背景と枠を付ける。
 * face は文字か、アイコン（mod の中の svg のパス `mods/<mod>/<name>.svg`）とツールチップ
 */
export function footerButton(id: string, face: { text: string } | { icon: string; tooltip: string }, active: boolean, t: Theme, onClick: (cx: Context) => void) {
  const icon = "icon" in face;
  return div()
    .id(id)
    .flex()
    .items_center()
    .h(18)
    .px(icon ? 4 : 8)
    .rounded(4)
    .border_1()
    .border_color(active ? t.border : "#00000000")
    .text_size(11)
    .cursor_pointer()
    .when(active, (el) => el.bg(t.raised).text_color(t.foreground))
    .when(!active, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .when(icon, (el) => el.tooltip((face as { tooltip: string }).tooltip))
    .child(icon ? svg(face.icon).size(12) : face.text);
}
