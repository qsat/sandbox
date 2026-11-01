const ICON: Record<string, string> = { blocked: "▲", error: "✖", idle: "○", working: "●", done: "✔" };

export function statusIcon(status: string) {
  return ICON[status] ?? "?";
}
