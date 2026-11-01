import { isUnderPath } from "./is-under-path";

/** candidates のうち p を含む最も深いもの */
export function findContainingPath(p: string, candidates: Iterable<string>) {
  let best: string | undefined;
  for (const c of candidates) if (isUnderPath(p, c) && (!best || c.length > best.length)) best = c;
  return best;
}
