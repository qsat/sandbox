import { usageTone } from "./usage-tone";

export function contextUsage(a: { contextUsedPercentage?: number; alive: boolean; resumable: boolean }) {
  if (a.contextUsedPercentage === undefined || !a.alive || a.resumable) return undefined;
  const used = Math.min(100, Math.max(0, Math.round(a.contextUsedPercentage)));
  return { used, tone: usageTone(used), text: `ctx ${used}%` };
}
