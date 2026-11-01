import type { Tag } from "./tag";

/**
 * エージェントの行に添える印。
 * @param attached 会話ペインが開いているか（クライアントが分からなければ undefined で、印を出さない）
 */
export function agentTags(a: { needsResume: boolean; missingLocation: boolean; parent: string | null; alive: boolean }, attached?: boolean): Tag[] {
  const tags: Tag[] = [];
  if (a.needsResume) tags.push({ text: "要再開", tone: "strong" });
  if (attached === false) tags.push({ text: "未attach", tone: "muted" });
  if (a.missingLocation) tags.push({ text: "場所消失", tone: "danger" });
  if (a.parent) tags.push({ text: `子:${a.parent}`, tone: "muted" });
  if (!a.alive) tags.push({ text: "終了", tone: "muted" });
  return tags;
}
