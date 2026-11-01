// 木の組み立てと参照の解決。I/O なし。

import { findContainingPath } from "@herdr-tools/utils/find-containing-path";
import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";
import {
  byName,
  displayName,
  toAgentNode,
  workspacePathFromCommonDir,
  type AgentNode,
  type AgentRecord,
  type PathInfo,
  type Tree,
  type WorkspaceNode,
  type WorktreeNode,
} from "./model";

/** エージェントの居場所の手がかり（起動時の記録を優先、無ければ cwd） */
export function agentAnchor(a: AgentRecord): string {
  return a.worktreeHint || a.cwd;
}

/**
 * WorkspaceSource で調べる必要のあるパス。
 * @param include エージェントがいなくても木に出す場所（クライアントが開いている作業場所、--all のときの全エントリ）
 */
export function collectCandidatePaths(agents: AgentRecord[], include: string[]): string[] {
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

interface WtAcc {
  path: string;
  branch: string | null;
  exists: boolean;
  workspace: string;
  agents: AgentRecord[];
}

export function buildTree(input: BuildInput): Tree {
  const infoByPath = new Map(input.infos.map((i) => [i.path, i]));
  const wts = new Map<string, WtAcc>();

  const ensure = (p: string, fallbackWorkspace?: string): WtAcc => {
    const info = infoByPath.get(p);
    const key = info?.exists && info.toplevel ? info.toplevel : trimTrailingSlash(p);
    let acc = wts.get(key);
    if (!acc) {
      acc = {
        path: key,
        branch: info?.branch ?? null,
        exists: info ? info.exists : true,
        workspace: info?.commonDir ? workspacePathFromCommonDir(info.commonDir) : fallbackWorkspace || key,
        agents: [],
      };
      wts.set(key, acc);
    }
    return acc;
  };

  for (const a of input.agents) ensure(agentAnchor(a), a.workspaceHint).agents.push(a);
  for (const p of input.include) if (p) ensure(p);

  const workspaces = new Map<string, WorkspaceNode>();
  for (const acc of wts.values()) {
    let ws = workspaces.get(acc.workspace);
    if (!ws) {
      ws = { path: acc.workspace, name: displayName(acc.workspace, input.root, input.home), worktrees: [] };
      workspaces.set(acc.workspace, ws);
    }
    ws.worktrees.push({
      path: acc.path,
      branch: acc.branch,
      exists: acc.exists,
      isMain: acc.path === acc.workspace,
      agents: acc.agents.map((a) => toAgentNode(a, acc.exists)).sort(byName),
    });
  }

  const out = [...workspaces.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const ws of out) ws.worktrees.sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path));
  return { workspaces: out };
}

// ---------------------------------------------------------------------------
// 場所の特定と参照の解決
// ---------------------------------------------------------------------------

export interface Located {
  workspace: WorkspaceNode;
  worktree: WorktreeNode;
}

export type Locate = (path: string) => Located | undefined;

/** 生のパス（クライアントが持っているもの）から木の worktree を引く。調べ済みのパスは toplevel で正規化する */
export function makeLocator(tree: Tree, infos: PathInfo[]): Locate {
  const infoByPath = new Map(infos.map((i) => [i.path, i]));
  const byPath = new Map<string, Located>();
  for (const workspace of tree.workspaces) for (const worktree of workspace.worktrees) byPath.set(worktree.path, { workspace, worktree });
  return (path) => {
    const key = infoByPath.get(path)?.toplevel ?? trimTrailingSlash(path);
    return byPath.get(key) ?? byPath.get(findContainingPath(key, byPath.keys()) ?? "");
  };
}

export type Resolved = ({ kind: "worktree" } & Located) | ({ kind: "agent"; agent: AgentNode } & Located);

export function looksLikePath(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("~") || ref.startsWith(".");
}

/** ref はエージェントの id（または名前）か、worktree のパス（絶対パス化済み。snapshot の include に入れておく） */
export function resolveRef(snap: { tree: Tree; locate: Locate }, ref: string): Resolved | undefined {
  if (looksLikePath(ref)) {
    const hit = snap.locate(ref);
    return hit && { kind: "worktree", ...hit };
  }
  for (const match of [(a: AgentNode) => a.id === ref, (a: AgentNode) => a.name === ref])
    for (const workspace of snap.tree.workspaces)
      for (const worktree of workspace.worktrees)
        for (const agent of worktree.agents) if (match(agent)) return { kind: "agent", agent, worktree, workspace };
  return undefined;
}

/** 場所が消えた worktree に残っているエージェント */
export function planPrune(tree: Tree): AgentNode[] {
  return tree.workspaces.flatMap((w) => w.worktrees).flatMap((wt) => (wt.exists ? [] : wt.agents));
}
