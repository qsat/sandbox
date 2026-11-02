import { basename } from "./basename";

export function worktreeDisplayName(wt: { path: string; branch: string | null }) {
  return wt.branch ?? basename(wt.path);
}
