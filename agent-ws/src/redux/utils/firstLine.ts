/** 空でない最初の行（長ければ max 文字で切る） */
export function firstLine(s: string | undefined, max = 80): string | undefined {
  const line = s?.split("\n").map((l) => l.trim()).find(Boolean);
  return line && line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
