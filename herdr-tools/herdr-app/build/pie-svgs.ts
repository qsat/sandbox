import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 円の外側の半径（viewBox は 24×24） */
const R = 12;
/** 輪の内側の半径。輪の太さは R - INNER（24 のうち 4。12px で描くと 2px） */
const INNER = 8;

/**
 * 消費した割合を、円周の上の弧（輪の一部）で表す SVG。12 時から時計回り。
 * 線（stroke）ではなく、外側の弧と内側の弧で囲んだ形を塗る。100% は輪の全体
 */
export function pieSvg(percent: number) {
  const body =
    percent >= 100
      ? `<path d="M${R} 0A${R} ${R} 0 1 1 ${R} ${2 * R}A${R} ${R} 0 1 1 ${R} 0ZM${R} ${R - INNER}A${INNER} ${INNER} 0 1 0 ${R} ${R + INNER}A${INNER} ${INNER} 0 1 0 ${R} ${R - INNER}Z"/>`
      : (() => {
          const angle = (percent / 100) * 2 * Math.PI;
          const point = (radius: number) => `${(R + radius * Math.sin(angle)).toFixed(3)} ${(R - radius * Math.cos(angle)).toFixed(3)}`;
          const large = percent > 50 ? 1 : 0;
          return `<path d="M${R} 0A${R} ${R} 0 ${large} 1 ${point(R)}L${point(INNER)}A${INNER} ${INNER} 0 ${large} 0 ${R} ${R - INNER}Z"/>`;
        })();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">${body}</svg>\n`;
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: bun herdr-app/build/pie-svgs.ts <出力先>");
  mkdirSync(outDir, { recursive: true });
  for (let p = 1; p <= 100; p++) writeFileSync(join(outDir, `${p}.svg`), pieSvg(p));
}
