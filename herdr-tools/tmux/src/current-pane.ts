import type { TmuxClient, TmuxPane } from "./facts";
import { firstGhosttyClient, mostRecentClient } from "./plans/go";

/** list-panes の 1 行。active は、そのペインがセッションのアクティブなウィンドウのアクティブなペインであること */
export type PaneLine = Omit<TmuxPane, "current"> & { active: boolean };

/**
 * 今いるペインを、ws が --from-app で操作するクライアント（chooseClient と同じ、最初につながった Ghostty のウインドウ）が
 * 表示しているペインだけにする。Ghostty のクライアントが無ければ、最後に操作したクライアントにする。
 * クライアントが複数あり（Ghostty と Herdr app のターミナルなど）、それぞれが別のセッションを見ていると、
 * セッションごとのアクティブなペインがどれも「表示中」になり、今いる場所の印が複数の行に残るため。
 */
export function markCurrentPanes(panes: PaneLine[], clients: TmuxClient[]): TmuxPane[] {
  const shown = firstGhosttyClient(clients) ?? mostRecentClient(clients);
  return panes.map(({ active, ...p }) => ({ ...p, current: shown !== undefined && active && p.session === shown.session }));
}
