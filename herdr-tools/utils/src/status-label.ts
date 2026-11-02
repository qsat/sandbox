export function statusLabel(a: { status: string; blockedReason?: string }) {
  return a.status === "blocked" && a.blockedReason ? `blocked(${a.blockedReason})` : a.status;
}
