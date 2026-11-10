import { isUnder } from "./isUnder.ts";

/** ghq root からの相対名（root の外なら絶対パスのまま） */
export function repoName(path: string, roots: string[]): string {
  const root = roots.find((r) => r !== path && isUnder(path, r));
  if (!root) return path;
  return path.slice(root.length).replace(/^\//, "");
}
