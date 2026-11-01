/** エージェントの状態の表示。blocked は理由（permission など）を添える */
export function statusLabel(a: { status: string; kind?: string }) {
  return a.status === "blocked" && a.kind ? `blocked(${a.kind})` : a.status;
}
