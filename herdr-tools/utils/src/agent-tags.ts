import type { Tag } from "./tag";

export function agentTags(a: { missingLocation: boolean; parent: string | null; alive: boolean }, attached?: boolean) {
  const tags: Tag[] = [];
  if (attached === false) tags.push({ text: "未attach", tone: "muted" });
  if (a.missingLocation) tags.push({ text: "場所消失", tone: "danger" });
  if (a.parent) tags.push({ text: `子:${a.parent}`, tone: "muted" });
  if (!a.alive) tags.push({ text: "終了", tone: "muted" });
  return tags;
}
