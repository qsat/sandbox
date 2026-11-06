import { execWs } from "./ws-exec";
import { parseList } from "./ws-list";
import { resolveTarget, type Target } from "./target";

/** ws list --json で、tmux で今いるペインの worktree を決める。読めなければ前の値のまま、理由を error に返す */
export async function readCurrentTarget(previous: Target | null) {
  const r = await execWs(["list", "--json"]);
  return r.ok ? { target: resolveTarget(parseList(r.stdout), previous), error: "" } : { target: previous, error: r.error };
}
