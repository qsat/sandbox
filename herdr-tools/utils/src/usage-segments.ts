import { countdown } from "./countdown";
import type { Tag } from "./tag";

type Window = { usedPercentage: number; resetsAtEpochSec: number };

export function usageSegments(usage: { fiveHour?: Window; sevenDay?: Window }, nowEpochSec: number) {
  const segment = (windowName: string, w: Window, unit: "minutes" | "hours") => {
    const used = Math.min(100, Math.max(0, Math.round(w.usedPercentage)));
    const tone: Tag["tone"] = used >= 90 ? "danger" : used >= 70 ? "strong" : "muted";
    const timeLeft = countdown(w.resetsAtEpochSec - nowEpochSec, unit);
    return { windowName, used, timeLeft, tone, text: `${used}% ${timeLeft}` };
  };
  return [
    ...(usage.fiveHour ? [segment("5時間枠", usage.fiveHour, "minutes")] : []),
    ...(usage.sevenDay ? [segment("週の枠", usage.sevenDay, "hours")] : []),
  ];
}
