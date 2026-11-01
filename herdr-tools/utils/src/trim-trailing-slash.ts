export function trimTrailingSlash(p: string) {
  return p.replace(/\/+$/g, "") || (p.startsWith("/") ? "/" : p);
}
