import { basename } from "@herdr-tools/utils/basename";
import { dirname } from "@herdr-tools/utils/dirname";
import { isUnderPath } from "@herdr-tools/utils/is-under-path";
import { trimTrailingSlash } from "@herdr-tools/utils/trim-trailing-slash";
import { agentLocation, byName, toAgentNode, type AgentNode, type AgentRecord } from "./agent";

export interface PathInspection {
  path: string;
  exists: boolean;
  toplevel?: string;
  commonDir?: string;
  branch?: string | null;
}

export interface WorktreeNode {
  path: string;
  branch: string | null;
  exists: boolean;
  isMain: boolean;
  agents: AgentNode[];
}

export interface WorkspaceNode {
  path: string;
  name: string;
  worktrees: WorktreeNode[];
}

export interface Tree {
  workspaces: WorkspaceNode[];
}

export function mainRepositoryOf(gitCommonDir: string) {
  return basename(gitCommonDir) === ".git" ? dirname(gitCommonDir) : gitCommonDir;
}

export function workspaceDisplayName(path: string, ghqRoot: string | undefined, home: string | undefined) {
  if (ghqRoot && isUnderPath(path, ghqRoot) && path !== trimTrailingSlash(ghqRoot)) return path.slice(trimTrailingSlash(ghqRoot).length + 1);
  if (home && isUnderPath(path, home)) return "~" + path.slice(trimTrailingSlash(home).length);
  return path;
}

export function pathsToInspect(agents: AgentRecord[], alwaysShow: string[]) {
  return [...new Set([...agents.map(agentLocation), ...alwaysShow].filter(Boolean))];
}

export function buildTree(input: { agents: AgentRecord[]; inspections: PathInspection[]; alwaysShow: string[]; ghqRoot?: string; home?: string }) {
  const inspectionOf = new Map(input.inspections.map((i) => [i.path, i]));
  const worktreeKey = (p: string) => {
    const i = inspectionOf.get(p);
    return i?.exists && i.toplevel ? i.toplevel : trimTrailingSlash(p);
  };
  const places = [
    ...input.agents.map((agent) => ({ path: agentLocation(agent), agent })),
    ...input.alwaysShow.filter(Boolean).map((path) => ({ path, agent: undefined })),
  ];

  const worktrees = [...Map.groupBy(places, (x) => worktreeKey(x.path))].map(([path, xs]) => {
    const inspection = xs.map((x) => inspectionOf.get(x.path)).find(Boolean);
    const agents = xs.flatMap((x) => (x.agent ? [x.agent] : []));
    const exists = inspection?.exists ?? true;
    const workspace = inspection?.commonDir ? mainRepositoryOf(inspection.commonDir) : agents.find((a) => a.recordedWorkspace)?.recordedWorkspace || path;
    const node = { path, branch: inspection?.branch ?? null, exists, isMain: path === workspace, agents: agents.map((a) => toAgentNode(a, exists)).sort(byName) };
    return { workspace, node };
  });

  const workspaces = [...Map.groupBy(worktrees, (w) => w.workspace)].map(([path, ws]) => ({
    path,
    name: workspaceDisplayName(path, input.ghqRoot, input.home),
    worktrees: ws.map((w) => w.node).sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path)),
  }));
  return { workspaces: workspaces.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function agentsInMissingWorktrees(tree: Tree) {
  return tree.workspaces.flatMap((w) => w.worktrees).flatMap((wt) => (wt.exists ? [] : wt.agents));
}
