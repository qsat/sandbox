import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const R = 12;

export function pieSvg(percent: number) {
  const body =
    percent >= 100
      ? `<circle cx="${R}" cy="${R}" r="${R}"/>`
      : (() => {
          const angle = (percent / 100) * 2 * Math.PI;
          const x = (R + R * Math.sin(angle)).toFixed(3);
          const y = (R - R * Math.cos(angle)).toFixed(3);
          return `<path d="M${R} ${R}L${R} 0A${R} ${R} 0 ${percent > 50 ? 1 : 0} 1 ${x} ${y}Z"/>`;
        })();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">${body}</svg>\n`;
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: bun herdr-app/build/pie-svgs.ts <出力先>");
  mkdirSync(outDir, { recursive: true });
  for (let p = 1; p <= 100; p++) writeFileSync(join(outDir, `${p}.svg`), pieSvg(p));
}
