import { trimTrailingSlash } from "./trim-trailing-slash";

export function basename(p: string) {
  const t = trimTrailingSlash(p);
  return t.slice(t.lastIndexOf("/") + 1);
}
