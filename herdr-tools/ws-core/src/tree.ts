// 木の組み立てと参照の解決。I/O なし。

import {
  attentionRank,
  displayName,
  findContainingPath,
  isUnderPath,
  needsResume,
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

export interface CandidateInput {
  agents: AgentRecord[];
  entries: string[];
  all: boolean;
  /** クライアントが「これも見たい」と渡すパス（tmux のセッションの場所など） */
  include?: string[];
}

/** WorkspaceSource で調べる必要のあるパス */
export function collectCandidatePaths(input: CandidateInput): string[] {
  const s = new Set<string>();
  for (const a of input.agents) {
    const p = agentAnchor(a);
    if (p) s.add(p);
  }
  for (const p of input.include ?? []) if (p) s.add(p);
  if (input.all) for (const e of input.entries) s.add(e);
  return [...s];
}

export interface BuildInput {
  agents: AgentRecord[];
  infos: PathInfo[];
  /** 作業場所の全エントリ（ghq list） */
  entries: string[];
  root?: string;
  home?: string;
  all: boolean;
  /** エージェントがいなくても必ず含めるパス */
  include?: string[];
}

interface WtAcc {
  path: string;
  branch: string | null;
  exists: boolean;
  workspace: string;
  agents: AgentRecord[];
  included: boolean;
}

export function buildTree(input: BuildInput): Tree {
  const infoByPath = new Map(input.infos.map((i) => [i.path, i]));
  const wts = new Map<string, WtAcc>();

  const keyOf = (p: string): { key: string; info?: PathInfo } => {
    const info = infoByPath.get(p);
    if (info?.exists && info.toplevel) return { key: info.toplevel, info };
    return { key: p.replace(/\/+$/g, "") || p, info };
  };

  const ensure = (p: string, fallbackWorkspace?: string): WtAcc => {
    const { key, info } = keyOf(p);
    let acc = wts.get(key);
    if (!acc) {
      acc = {
        path: key,
        branch: info?.branch ?? null,
        exists: info ? info.exists : true,
        workspace: info?.commonDir ? workspacePathFromCommonDir(info.commonDir) : fallbackWorkspace || key,
        agents: [],
        included: false,
      };
      wts.set(key, acc);
    }
    return acc;
  };

  for (const a of input.agents) {
    const anchor = agentAnchor(a);
    // 調べられなかった cwd は、既知の作業場所のどれかに境界判定で含める
    if (!infoByPath.has(anchor) && !a.worktreeHint) {
      const known = findContainingPath(anchor, [...wts.keys(), ...input.entries]);
      if (known) {
        ensure(known, a.workspaceHint).agents.push(a);
        continue;
      }
    }
    ensure(anchor, a.workspaceHint).agents.push(a);
  }
  for (const p of input.include ?? []) if (p) ensure(p).included = true;
  if (input.all) for (const e of input.entries) if (infoByPath.get(e)?.exists !== false) ensure(e);

  const workspaces = new Map<string, WorkspaceNode>();
  for (const acc of wts.values()) {
    if (!input.all && !acc.included && acc.agents.length === 0) continue;
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

export function byName(a: AgentNode, b: AgentNode): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function byAttention(a: AgentNode, b: AgentNode): number {
  return attentionRank(a) - attentionRank(b) || byName(a, b);
}

function toAgentNode(a: AgentRecord, wtExists: boolean): AgentNode {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    kind: a.kind,
    msg: a.msg,
    alive: a.alive,
    parent: a.parent,
    cwd: a.cwd,
    sessionId: a.sessionId,
    needsResume: needsResume(a),
    missingLocation: !!a.worktreeHint && !wtExists,
  };
}

// ---------------------------------------------------------------------------
// 場所の特定と参照の解決
// ---------------------------------------------------------------------------

export interface Located {
  workspace: WorkspaceNode;
  worktree: WorktreeNode;
}

export type Locate = (path: string) => Located | undefined;

/** 生のパス（クライアントが持っているもの）から木の worktree を引く */
export function makeLocator(tree: Tree, infos: PathInfo[]): Locate {
  const infoByPath = new Map(infos.map((i) => [i.path, i]));
  const byPath = new Map<string, Located>();
  for (const workspace of tree.workspaces) for (const worktree of workspace.worktrees) byPath.set(worktree.path, { workspace, worktree });
  return (path: string) => {
    const p = path.replace(/\/+$/g, "") || path;
    const key = infoByPath.get(path)?.toplevel ?? p;
    const hit = byPath.get(key);
    if (hit) return hit;
    const containing = findContainingPath(key, byPath.keys());
    return containing ? byPath.get(containing) : undefined;
  };
}

export type Resolved = ({ kind: "worktree" } & Located) | ({ kind: "agent"; agent: AgentNode } & Located);

export function looksLikePath(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("~") || ref.startsWith(".");
}

/** ref はエージェントの id（または名前）か、worktree のパス（絶対パス化済み） */
export function resolveRef(tree: Tree, ref: string): Resolved | undefined {
  if (!looksLikePath(ref)) {
    for (const match of [(a: AgentNode) => a.id === ref, (a: AgentNode) => a.name === ref])
      for (const workspace of tree.workspaces)
        for (const worktree of workspace.worktrees)
          for (const agent of worktree.agents) if (match(agent)) return { kind: "agent", agent, worktree, workspace };
  }
  let best: Resolved | undefined;
  for (const workspace of tree.workspaces)
    for (const worktree of workspace.worktrees)
      if (isUnderPath(ref, worktree.path) && (!best || worktree.path.length > best.worktree.path.length))
        best = { kind: "worktree", worktree, workspace };
  return best;
}

// ---------------------------------------------------------------------------
// 片付けの計画
// ---------------------------------------------------------------------------

/** 場所が消えた worktree に残っているエージェント */
export function planPrune(tree: Tree): { worktrees: WorktreeNode[]; agents: AgentNode[] } {
  const worktrees = tree.workspaces.flatMap((w) => w.worktrees).filter((wt) => !wt.exists);
  return { worktrees, agents: worktrees.flatMap((wt) => wt.agents) };
}
