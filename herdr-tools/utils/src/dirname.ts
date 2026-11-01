import { trimTrailingSlash } from "./trim-trailing-slash";

export function dirname(p: string) {
  const t = trimTrailingSlash(p);
  const i = t.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return t.slice(0, i);
}
