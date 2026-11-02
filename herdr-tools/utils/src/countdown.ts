export function countdown(seconds: number, unit: "minutes" | "hours" = "minutes") {
  const s = Math.max(0, Math.floor(seconds));
  const days = `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  return unit === "hours" ? days : `${days} ${Math.floor((s % 3600) / 60)}m`;
}
