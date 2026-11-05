import { div, type Element } from "gpui-kit";
import { run } from "herdr";
import type { Theme } from "./row-view";

/**
 * レイアウト（layouts/agents.json）の下半分の stack の id。commit-history と pull-requests を重ねて置き、
 * 題名の帯のタブで切り替える（Herdr app の stack の帯は番号しか出さないため、mod の帯をタブにする）
 */
export const LOWER_STACK_ID = "lower";

export type LowerTab = "commit-history" | "pull-requests";

/** タブの並び。id は stack の子の id と同じ */
export const LOWER_TABS: { id: LowerTab; title: string }[] = [
  { id: "commit-history", title: "Commits" },
  { id: "pull-requests", title: "Pull requests" },
];

/** 題名の帯の右側に出す件数の枠（数字だけ） */
export function countBadge(count: number, t: Theme) {
  return div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(count));
}

/** 題名の帯に出すタブ。選んでいるタブは太字、ほかのタブは押すと stack をそのタブに切り替える */
export function stackTabs(active: LowerTab, t: Theme): Element[] {
  return LOWER_TABS.map((tab) =>
    tab.id === active
      ? div().font_semibold().child(tab.title)
      : div()
          .id(`stack-tab:${tab.id}`)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            run("layout.select", { stack: LOWER_STACK_ID, child: tab.id });
          })
          .child(tab.title),
  );
}
