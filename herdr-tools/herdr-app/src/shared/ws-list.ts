import type { ListedTree } from "@herdr-tools/tmux/list-json";

/** mod が exec する ws コマンド（agent-board と commit-history で共通） */
export const WS = "ws";

export const EMPTY_LIST: ListedTree = { workspaces: [], usage: {} };

/** `ws list --json` の標準出力を読む。壊れていれば空の一覧にする */
export function parseList(stdout: string): ListedTree {
  try {
    const v = JSON.parse(stdout);
    return v && Array.isArray(v.workspaces) ? { ...v, usage: v.usage ?? {} } : EMPTY_LIST;
  } catch {
    return EMPTY_LIST;
  }
}
