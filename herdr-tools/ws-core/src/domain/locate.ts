import { findContainingPath } from "@herdr-tools/utils/find-containing-path";
import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";
import type { AgentNode } from "./agent";
import type { PathInspection, Tree } from "./tree";

export function makeLocator(tree: Tree, inspections: PathInspection[]) {
  const toplevelOf = new Map(inspections.map((i) => [i.path, i.toplevel]));
  const byPath = new Map(tree.workspaces.flatMap((workspace) => workspace.worktrees.map((worktree) => [worktree.path, { workspace, worktree }] as const)));
  return (path: string) => {
    const key = toplevelOf.get(path) ?? trimTrailingSlash(path);
    return byPath.get(key) ?? byPath.get(findContainingPath(key, byPath.keys()) ?? "");
  };
}

export type Locate = ReturnType<typeof makeLocator>;

export function looksLikePath(ref: string) {
  return ref.startsWith("/") || ref.startsWith("~") || ref.startsWith(".");
}

export function resolveRef(snap: { tree: Tree; locate: Locate }, ref: string) {
  if (looksLikePath(ref)) {
    const hit = snap.locate(ref);
    return hit && { kind: "worktree" as const, ...hit };
  }
  for (const matches of [(a: AgentNode) => a.id === ref, (a: AgentNode) => a.name === ref])
    for (const workspace of snap.tree.workspaces)
      for (const worktree of workspace.worktrees)
        for (const agent of worktree.agents) if (matches(agent)) return { kind: "agent" as const, agent, worktree, workspace };
  return undefined;
}

export type Resolved = NonNullable<ReturnType<typeof resolveRef>>;
