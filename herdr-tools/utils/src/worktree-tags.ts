import type { Tag } from "./tag";

/** worktree の行に添える印（ブランチ、tmux のセッション、場所消失） */
export function worktreeTags(wt: { branch: string | null; exists: boolean }, session?: { attached: boolean } | null) {
  const tags: Tag[] = [];
  if (wt.branch) tags.push({ text: `[${wt.branch}]`, tone: "muted" });
  if (session) tags.push({ text: session.attached ? "tmux*" : "tmux", tone: "muted" });
  if (!wt.exists) tags.push({ text: "場所消失", tone: "danger" });
  return tags;
}
