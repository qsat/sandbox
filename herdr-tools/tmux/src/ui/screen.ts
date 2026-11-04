const ANSI_OR_CHAR = /\x1b\[[0-9;?]*[A-Za-z]|[\s\S]/gu;
const RESET = "\x1b[0m";

export function fitToWidth(s: string, width: number) {
  let used = 0;
  let out = "";
  let styled = false;
  for (const [token] of s.matchAll(ANSI_OR_CHAR)) {
    if (token.startsWith("\x1b[")) {
      out += token;
      styled = token !== RESET;
      continue;
    }
    const w = Bun.stringWidth(token);
    if (used + w > width) return styled ? out + RESET : out;
    used += w;
    out += token;
  }
  return out;
}

function visibleWidth(s: string) {
  return Bun.stringWidth(s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
}

export function alignRight(s: string, width: number) {
  return " ".repeat(Math.max(0, width - visibleWidth(s))) + s;
}

export function withBackground(s: string, bg: string, width: number) {
  const fitted = fitToWidth(s, width);
  const fill = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
  return bg + fitted.replaceAll(RESET, RESET + bg) + fill + RESET;
}

export function frame(lines: string[], size: { columns: number; rows: number }, padding: { x: number; y: number }) {
  const margin = " ".repeat(padding.x);
  const inner = Math.max(0, size.columns - padding.x * 2);
  const body = lines.slice(0, Math.max(0, size.rows - padding.y * 2)).map((l) => margin + fitToWidth(l, inner));
  return [...Array<string>(padding.y).fill(""), ...body].join("\r\n");
}
