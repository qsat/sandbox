import type { Tag } from "./tag";

type Window = { usedPercentage: number; resetsAtEpochSec: number };

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function usageSegments(usage: { fiveHour?: Window; sevenDay?: Window }) {
  const segment = (label: string, w: Window, resetsAt: string) => {
    const remaining = Math.max(0, Math.round(100 - w.usedPercentage));
    const tone: Tag["tone"] = remaining <= 10 ? "danger" : remaining <= 30 ? "strong" : "muted";
    return { label, remaining, resetsAt, tone, text: `${label} 残り${remaining}%（${resetsAt}）` };
  };
  const at = (w: Window) => new Date(w.resetsAtEpochSec * 1000);
  return [
    ...(usage.fiveHour ? [segment("5h", usage.fiveHour, clock(at(usage.fiveHour)))] : []),
    ...(usage.sevenDay ? [segment("週", usage.sevenDay, `${at(usage.sevenDay).getMonth() + 1}/${at(usage.sevenDay).getDate()} ${clock(at(usage.sevenDay))}`)] : []),
  ];
}
