import { trimTrailingSlash } from "./trim-trailing-slash";

/** パスの最後の要素 */
export function basename(p: string) {
  const t = trimTrailingSlash(p);
  return t.slice(t.lastIndexOf("/") + 1);
}
