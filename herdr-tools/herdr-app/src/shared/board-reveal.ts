// agent-board と workspace-picker が Herdr app の共有値（shared / setShared）でやりとりするときの名前と形。I/O なし

/** agent-board で畳んだ workspace のパスの一覧のキー。ws step も同じ値を読むので、定義は sidebar-order.ts の 1 か所に置く */
export { COLLAPSED_KEY } from "@herdr-tools/tmux/sidebar-order";

/** workspace-picker が agent-board に「この worktree の行を選んで」と頼む値 */
export const REVEAL_KEY = "agent-board.reveal";

export interface RevealRequest {
  /** 選ぶ worktree のパス */
  path: string;
  /** 頼んだ時刻（ミリ秒）。同じ頼みを二度こなさないための印 */
  at: number;
}

/** 共有値から頼みを読む。形が違えば null */
export function readReveal(v: unknown): RevealRequest | null {
  const r = v as Partial<RevealRequest> | null | undefined;
  return r && typeof r.path === "string" && typeof r.at === "number" ? { path: r.path, at: r.at } : null;
}

/** 頼まれた worktree が見えるように、その workspace を畳んだ一覧から外す */
export function unfold(collapsed: string[], workspacePath: string) {
  return collapsed.filter((p) => p !== workspacePath);
}
