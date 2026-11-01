import { byAttention, type WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxIndex } from "../tmux-index";

export function planPanes(wt: WorktreeNode, idx: TmuxIndex, opts: { includeChildren: boolean; max: number }) {
  const notYetOpen = wt.agents.filter((a) => a.alive && (opts.includeChildren || !a.parent) && !idx.isAttached(a.id)).sort(byAttention);
  const open = notYetOpen.slice(0, Math.max(0, opts.max));
  return { open, overLimit: notYetOpen.slice(open.length) };
}
