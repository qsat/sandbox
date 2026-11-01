/** 末尾の / を落とす（ルート "/" はそのまま） */
export function trimTrailingSlash(p: string) {
  return p.replace(/\/+$/g, "") || (p.startsWith("/") ? "/" : p);
}
