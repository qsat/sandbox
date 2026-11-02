export interface UsageWindow {
  usedPercentage: number;
  resetsAtEpochSec: number;
}

export interface ClaudeUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
}

function stillOpen(w: UsageWindow | undefined, nowEpochSec: number) {
  return w && w.resetsAtEpochSec > nowEpochSec ? w : undefined;
}

export function openWindows(usage: ClaudeUsage | undefined, nowEpochSec: number): ClaudeUsage {
  const fiveHour = stillOpen(usage?.fiveHour, nowEpochSec);
  const sevenDay = stillOpen(usage?.sevenDay, nowEpochSec);
  return { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) };
}

export function sameUsage(a: ClaudeUsage | undefined, b: ClaudeUsage) {
  const same = (x?: UsageWindow, y?: UsageWindow) => x?.usedPercentage === y?.usedPercentage && x?.resetsAtEpochSec === y?.resetsAtEpochSec;
  return same(a?.fiveHour, b.fiveHour) && same(a?.sevenDay, b.sevenDay);
}
