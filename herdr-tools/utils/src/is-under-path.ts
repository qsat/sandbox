import { trimTrailingSlash } from "./trim-trailing-slash";

export function isUnderPath(child: string, base: string) {
  const b = trimTrailingSlash(base);
  return child === b || child.startsWith(b === "/" ? "/" : b + "/");
}
