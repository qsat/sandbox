import type { TmuxClient, TmuxPane } from "./facts";
import { mostRecentClient } from "./plans/go";

/** list-panes の 1 行。active は、そのペインがセッションのアクティブなウィンドウのアクティブなペインであること */
export type PaneLine = Omit<TmuxPane, "current"> & { active: boolean };

/**
 * 今いるペインを、最後に操作したクライアント（client_activity が一番新しい）が表示しているペインだけにする。
 * クライアントが複数あり（Ghostty と Herdr app のターミナルなど）、それぞれが別のセッションを見ていると、
 * セッションごとのアクティブなペインがどれも「表示中」になり、今いる場所の印が複数の行に残るため。
 * 移動先のクライアントを選ぶ chooseClient（--from-app）と同じクライアントを「今いる場所」とする。
 */
export function markCurrentPanes(panes: PaneLine[], clients: TmuxClient[]): TmuxPane[] {
  const latest = mostRecentClient(clients);
  return panes.map(({ active, ...p }) => ({ ...p, current: latest !== undefined && active && p.session === latest.session }));
}
