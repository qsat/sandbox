/** j / k（↓ / ↑）で選ぶ行を動かす。端で止まる。commit-history と pull-requests で共通 */
export function moveSelection(rows: { id: string }[], current: string | null, delta: 1 | -1): string | null {
  if (rows.length === 0) return null;
  const i = current ? rows.findIndex((r) => r.id === current) : -1;
  if (i < 0) return (delta === 1 ? rows[0] : rows.at(-1))?.id ?? null;
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))]?.id ?? null;
}
