const ICON: Record<string, string> = { blocked: "▲", error: "✖", idle: "○", working: "●", done: "✔" };

/** エージェントの状態のアイコン */
export function statusIcon(status: string): string {
  return ICON[status] ?? "?";
}
