import type { Context, FocusHandle, View } from "gpui-kit";
import { nextCommand, run } from "herdr";

/**
 * Tab で、上半分の agent-board と下半分の stack（worktree-changes・commit-history・pull-requests のうち表示中の mod）の間で
 * キーボードのフォーカスを移す。Herdr app の `pane.go` は、mod.json に `"focusable": true` を書いた表示中の mod へ移り、
 * 移った先の mod に nextCommand() で "focus" を届ける。届いた mod が自分のフォーカスハンドルにフォーカスを当てる
 */

/** Herdr app が、フォーカスを受け取る mod に届けるコマンドの名前 */
export const FOCUS_COMMAND = "focus";

/** フォーカスを移すキー */
export const FOCUS_MOVE_KEY = "tab";

/** 移る向き。layouts/agents.json は上に agent-board、下に stack を置くので、agent-board からは下、stack の mod からは上 */
export type FocusDirection = "up" | "down";

/** 今の mod から、その向きにある mod（かペイン）へフォーカスを移す */
export function moveFocus(direction: FocusDirection) {
  run("pane.go", { direction });
}

/** `pane.go` でこの mod に移ってきたとき（"focus" が届いたとき）に、キーボードを受け取る。ほかのコマンドは捨てる */
export function takeFocusOnCommand(cx: Context, owner: View, focus: FocusHandle) {
  cx.spawn(
    async (cx) => {
      for (;;) {
        if ((await nextCommand()) !== FOCUS_COMMAND) continue;
        focus.focus();
        cx.notify();
      }
    },
    { owner },
  );
}
