import { byAttention, type AgentNode, type WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxPane } from "../facts";
import type { TmuxIndex } from "../tmux-index";
import { AGENTS_WINDOW } from "./go";

export interface PaneToGather {
  agent: AgentNode;
  paneId: string;
}

/**
 * worktree のエージェントを session の agents ウィンドウに並べる計画。
 * - inPlace: もう agents ウィンドウに会話ペインがある（何もしない）
 * - gather: 会話ペインが別のウィンドウ・セッションにある（そのペインを agents ウィンドウへ移す。hc attach を二重にしない）
 * - open: 会話ペインが無い（agents ウィンドウに新しく開く）
 * 上限（max）は gather と open を合わせた数にかかり、注意が要る順に選ぶ
 */
export function planPanes(wt: WorktreeNode, idx: TmuxIndex, opts: { session: string; includeChildren: boolean; max: number }) {
  const isInAgentsWindow = (p: TmuxPane) => p.session === opts.session && p.window === AGENTS_WINDOW;
  const targets = wt.agents.filter((a) => a.alive && (opts.includeChildren || !a.parent));
  const inPlace = targets.filter((a) => idx.panesOf(a.id).some(isInAgentsWindow));
  const toArrange = targets.filter((a) => !inPlace.includes(a)).sort(byAttention);
  const chosen = toArrange.slice(0, Math.max(0, opts.max));
  const gather: PaneToGather[] = chosen.flatMap((agent) => {
    const pane = idx.panesOf(agent.id)[0];
    return pane ? [{ agent, paneId: pane.paneId }] : [];
  });
  const open = chosen.filter((a) => !idx.isAttached(a.id));
  return { inPlace, gather, open, overLimit: toArrange.slice(chosen.length) };
}
