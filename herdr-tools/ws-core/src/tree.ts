// 木の組み立てと参照の解決。I/O なし。

import { findContainingPath } from "@herdr-tools/utils/find-containing-path";
import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";
import { byName, displayName, toAgentNode, workspacePathFromCommonDir, type AgentNode, type AgentRecord, type PathInfo, type Tree } from "./model";

/** エージェントの居場所の手がかり（起動時の記録を優先、無ければ cwd） */
export function agentAnchor(a: AgentRecord) {
  return a.worktreeHint || a.cwd;
}

/**
 * WorkspaceSource で調べる必要のあるパス。
 * @param include エージェントがいなくても木に出す場所（クライアントが開いている作業場所、--all のときの全エントリ）
 */
export function collectCandidatePaths(agents: AgentRecord[], include: string[]) {
  return [...new Set([...agents.map(agentAnchor), ...include].filter(Boolean))];
}

export interface BuildInput {
  agents: AgentRecord[];
  infos: PathInfo[];
  /** エージェントがいなくても木に出す場所 */
  include: string[];
  root?: string;
  home?: string;
}

export function buildTree(input: BuildInput) {
  const infoByPath = new Map(input.infos.map((i) => [i.path, i]));
  // 調べたパス（エージェントの居場所と include）を worktree のトップでまとめる
  const places = [...input.agents.map((a) => ({ path: agentAnchor(a), agent: a })), ...input.include.filter(Boolean).map((path) => ({ path, agent: undefined }))];
  const keyOf = (p: string) => {
    const info = infoByPath.get(p);
    return info?.exists && info.toplevel ? info.toplevel : trimTrailingSlash(p);
  };

  const worktrees = [...Map.groupBy(places, (x) => keyOf(x.path))].map(([path, xs]) => {
    const info = xs.map((x) => infoByPath.get(x.path)).find(Boolean);
    const agents = xs.flatMap((x) => (x.agent ? [x.agent] : []));
    const exists = info ? info.exists : true;
    const workspace = info?.commonDir ? workspacePathFromCommonDir(info.commonDir) : agents.find((a) => a.workspaceHint)?.workspaceHint || path;
    return { workspace, node: { path, branch: info?.branch ?? null, exists, isMain: path === workspace, agents: agents.map((a) => toAgentNode(a, exists)).sort(byName) } };
  });

  const workspaces = [...Map.groupBy(worktrees, (w) => w.workspace)].map(([path, ws]) => ({
    path,
    name: displayName(path, input.root, input.home),
    worktrees: ws.map((w) => w.node).sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path)),
  }));
  return { workspaces: workspaces.sort((a, b) => a.name.localeCompare(b.name)) };
}

// ---------------------------------------------------------------------------
// 場所の特定と参照の解決
// ---------------------------------------------------------------------------

/** 生のパス（クライアントが持っているもの）から木の worktree を引く。調べ済みのパスは toplevel で正規化する */
export function makeLocator(tree: Tree, infos: PathInfo[]) {
  const infoByPath = new Map(infos.map((i) => [i.path, i]));
  const byPath = new Map(tree.workspaces.flatMap((workspace) => workspace.worktrees.map((worktree) => [worktree.path, { workspace, worktree }] as const)));
  return (path: string) => {
    const key = infoByPath.get(path)?.toplevel ?? trimTrailingSlash(path);
    return byPath.get(key) ?? byPath.get(findContainingPath(key, byPath.keys()) ?? "");
  };
}

export type Locate = ReturnType<typeof makeLocator>;

export function looksLikePath(ref: string) {
  return ref.startsWith("/") || ref.startsWith("~") || ref.startsWith(".");
}

/** ref はエージェントの id（または名前）か、worktree のパス（絶対パス化済み。snapshot の include に入れておく） */
export function resolveRef(snap: { tree: Tree; locate: Locate }, ref: string) {
  if (looksLikePath(ref)) {
    const hit = snap.locate(ref);
    return hit && { kind: "worktree" as const, ...hit };
  }
  for (const match of [(a: AgentNode) => a.id === ref, (a: AgentNode) => a.name === ref])
    for (const workspace of snap.tree.workspaces)
      for (const worktree of workspace.worktrees)
        for (const agent of worktree.agents) if (match(agent)) return { kind: "agent" as const, agent, worktree, workspace };
  return undefined;
}

export type Resolved = NonNullable<ReturnType<typeof resolveRef>>;

/** 場所が消えた worktree に残っているエージェント */
export function planPrune(tree: Tree) {
  return tree.workspaces.flatMap((w) => w.worktrees).flatMap((wt) => (wt.exists ? [] : wt.agents));
}
