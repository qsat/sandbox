import type { AgentNode, Resolved, WorktreeNode } from "@herdr-tools/ws-core";
import type { TmuxClient } from "../facts";
import { tmSessionName, type TmuxIndex } from "../tmux-index";

export const AGENTS_WINDOW = "agents";

export type Step =
  | { op: "newSession"; name: string; cwd: string }
  | { op: "selectPane"; paneId: string }
  | { op: "openAgentPane"; session: string; window: string; cwd: string; agentId: string }
  | { op: "switchClient"; client: string; target: string }
  | { op: "attachHere"; target: string }
  | { op: "newGhosttyWindow"; target: string }
  | { op: "focusGhostty" }
  | { op: "openHunkWindow"; session: string; cwd: string; argv: string[] }
  | { op: "respawnHunkWindow"; session: string; cwd: string; argv: string[] }
  | { op: "openEditWindow"; session: string; window: string; cwd: string; argv: string[] }
  | { op: "hunkReload"; cwd: string; hunkBin: string; args: string[] }
  | { op: "hunkNavigate"; cwd: string; file: string; wait: boolean };

export function mostRecentClient(clients: TmuxClient[]) {
  return [...clients].sort((a, b) => b.activity - a.activity)[0];
}

function isUnexpandedFormat(s: string) {
  return s.includes("#{");
}

export function chooseClient(opts: { explicit?: string; fromApp: boolean; callerClient?: string; clients: TmuxClient[] }) {
  const switchTo = (name: string) => ({ kind: "switch" as const, name });
  if (opts.explicit && !isUnexpandedFormat(opts.explicit)) return switchTo(opts.explicit);
  if (opts.fromApp) {
    const c = mostRecentClient(opts.clients);
    return c ? switchTo(c.name) : { kind: "newGhosttyWindow" as const };
  }
  if (opts.callerClient) return switchTo(opts.callerClient);
  return { kind: "attachHere" as const };
}

export function workingDir(wt: WorktreeNode, whenMissing: string) {
  return wt.exists ? wt.path : whenMissing;
}

export interface GoContext {
  client: ReturnType<typeof chooseClient>;
  fromApp: boolean;
  cwdWhenMissing: string;
}

export interface PaneTarget {
  kind: "pane";
  paneId: string;
}

export function planGo(target: Resolved | PaneTarget, idx: TmuxIndex, ctx: GoContext) {
  if (target.kind === "pane") return [{ op: "selectPane", paneId: target.paneId } as Step, ...bringClientTo(target.paneId, ctx)];
  const cwd = workingDir(target.worktree, ctx.cwdWhenMissing);
  const session = ensureSession(target.worktree, idx, cwd);
  const conversation = target.kind === "agent" ? enterConversation(target.agent, session.name, cwd, idx) : { target: session.name, steps: [] };
  return [...session.steps, ...conversation.steps, ...bringClientTo(conversation.target, ctx)];
}

export function ensureSession(wt: WorktreeNode, idx: TmuxIndex, cwd: string): { name: string; steps: Step[] } {
  const existing = idx.sessionOf(wt.path)?.name;
  if (existing) return { name: existing, steps: [] };
  const name = tmSessionName(wt.path);
  const sameNameElsewhere = idx.facts.sessions.some((s) => s.name === name);
  return { name, steps: sameNameElsewhere ? [] : [{ op: "newSession", name, cwd }] };
}

function enterConversation(agent: AgentNode, session: string, cwd: string, idx: TmuxIndex): { target: string; steps: Step[] } {
  const pane = idx.panesOf(agent.id)[0];
  if (pane) return { target: pane.paneId, steps: [{ op: "selectPane", paneId: pane.paneId }] };
  return { target: `${session}:${AGENTS_WINDOW}`, steps: [{ op: "openAgentPane", session, window: AGENTS_WINDOW, cwd, agentId: agent.id }] };
}

export function bringClientTo(target: string, ctx: GoContext): Step[] {
  switch (ctx.client.kind) {
    case "switch":
      return [{ op: "switchClient", client: ctx.client.name, target }, ...(ctx.fromApp ? [{ op: "focusGhostty" } as const] : [])];
    case "attachHere":
      return [{ op: "attachHere", target }];
    case "newGhosttyWindow":
      return [{ op: "newGhosttyWindow", target }];
  }
}
