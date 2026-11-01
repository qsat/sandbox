import { trimTrailingSlash } from "./trim-trailing-slash";

/**
 * child が base そのものか base/ 配下か。
 * 単純な前方一致だと ~/ghq/x/repo と ~/ghq/x/repo=branch が混ざるので、境界で判定する。
 */
export function isUnderPath(child: string, base: string) {
  const b = trimTrailingSlash(base);
  return child === b || child.startsWith(b === "/" ? "/" : b + "/");
}
