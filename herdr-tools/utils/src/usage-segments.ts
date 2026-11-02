import { countdown } from "./countdown";
import type { Tag } from "./tag";

type Window = { usedPercentage: number; resetsAtEpochSec: number };

export function usageSegments(usage: { fiveHour?: Window; sevenDay?: Window }, nowEpochSec: number) {
  const segment = (label: string, w: Window) => {
    const used = Math.min(100, Math.max(0, Math.round(w.usedPercentage)));
    const tone: Tag["tone"] = used >= 90 ? "danger" : used >= 70 ? "strong" : "muted";
    const timeLeft = countdown(w.resetsAtEpochSec - nowEpochSec);
    return { label, used, timeLeft, tone, text: `${label} ${used}% ${timeLeft}` };
  };
  return [...(usage.fiveHour ? [segment("5h", usage.fiveHour)] : []), ...(usage.sevenDay ? [segment("週", usage.sevenDay)] : [])];
}
