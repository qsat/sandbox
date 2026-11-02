import type { Tag } from "./tag";

export function usageTone(usedPercentage: number): Tag["tone"] {
  return usedPercentage >= 90 ? "danger" : usedPercentage >= 70 ? "strong" : "muted";
}
