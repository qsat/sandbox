// tmux との境界。ペインオプション(@hc)に 3.0 以上、display-popup に 3.2 以上が必要。

import type { TmuxClient, TmuxPane, TmuxSession } from "../domain";
import { run, runOk, runInteractive } from "./exec";

const TMUX_BIN = process.env.TMUX_BIN || "tmux";
/** テストなどで別サーバを使う: WS_TMUX_SOCKET=name で -L name を付ける */
const SOCKET = process.env.WS_TMUX_SOCKET;

function tmuxArgs(args: string[]): string[] {
  return SOCKET ? ["-L", SOCKET, ...args] : args;
}

async function tmux(args: string[]): Promise<string> {
  return runOk(TMUX_BIN, tmuxArgs(args));
}

/** サーバが動いていなければ空として扱う */
async function tmuxList(args: string[]): Promise<string[]> {
  const r = await run(TMUX_BIN, tmuxArgs(args));
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

// tmux は -F の出力中のタブなど制御文字を _ に置き換えるので、印字可能な区切りを使う
const SEP = "|@@|";

export async function listSessions(): Promise<TmuxSession[]> {
  const lines = await tmuxList(["list-sessions", "-F", ["#{session_name}", "#{session_path}", "#{session_attached}"].join(SEP)]);
  return lines.map((l) => {
    const [name = "", path = "", attached = "0"] = l.split(SEP);
    return { name, path, attached: Number(attached) > 0 };
  });
}

export async function listPanes(): Promise<TmuxPane[]> {
  const fmt = ["#{session_name}", "#{window_index}", "#{window_name}", "#{pane_id}", "#{@hc}", "#{pane_dead}", "#{pane_current_path}"].join(SEP);
  const lines = await tmuxList(["list-panes", "-a", "-F", fmt]);
  return lines.map((l) => {
    const [session = "", wi = "0", windowName = "", paneId = "", hc = "", dead = "0", currentPath = ""] = l.split(SEP);
    return { session, windowIndex: Number(wi), windowName, paneId, hc: hc || null, dead: dead === "1", currentPath };
  });
}

export async function listClients(): Promise<TmuxClient[]> {
  const lines = await tmuxList(["list-clients", "-F", ["#{client_activity}", "#{client_name}", "#{client_session}"].join(SEP)]);
  return lines.map((l) => {
    const [activity = "0", name = "", session = ""] = l.split(SEP);
    return { activity: Number(activity), name, session };
  });
}

/** tmux の中から呼ばれたとき、その端末のクライアント名 */
export async function currentClient(): Promise<string | undefined> {
  if (!process.env.TMUX) return undefined;
  const r = await run(TMUX_BIN, tmuxArgs(["display-message", "-p", "#{client_name}"]));
  const name = r.stdout.trim();
  return r.code === 0 && name ? name : undefined;
}

export async function paneInfo(paneId: string): Promise<{ session: string; currentPath: string } | undefined> {
  const r = await run(TMUX_BIN, tmuxArgs(["display-message", "-p", "-t", paneId, `#{session_name}${SEP}#{pane_current_path}`]));
  if (r.code !== 0) return undefined;
  const [session = "", currentPath = ""] = r.stdout.trim().split(SEP);
  return { session, currentPath };
}

export async function newSession(name: string, cwd: string): Promise<void> {
  await tmux(["new-session", "-d", "-s", name, "-c", cwd]);
}

export async function hasWindow(session: string, window: string): Promise<boolean> {
  const lines = await tmuxList(["list-windows", "-t", `=${session}`, "-F", "#{window_name}"]);
  return lines.includes(window);
}

/**
 * agents ウィンドウに会話ペインを作る（無ければウィンドウごと作る）。
 * 作ったペインに @hc=<address> を付け、ペインIDを返す。
 */
export async function openAttachPane(session: string, window: string, cwd: string, address: string, command: string): Promise<string> {
  let paneId: string;
  if (await hasWindow(session, window)) {
    paneId = (await tmux(["split-window", "-d", "-t", `=${session}:${window}`, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim();
    await tmux(["select-layout", "-t", `=${session}:${window}`, "tiled"]);
  } else {
    paneId = (await tmux(["new-window", "-d", "-t", `=${session}:`, "-n", window, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim();
  }
  await tmux(["set-option", "-p", "-t", paneId, "@hc", address]);
  await tmux(["select-pane", "-t", paneId]);
  await tmux(["select-window", "-t", paneId]);
  return paneId;
}

export async function selectPane(paneId: string): Promise<void> {
  await tmux(["select-window", "-t", paneId]);
  await tmux(["select-pane", "-t", paneId]);
}

export async function switchClient(client: string, target: string): Promise<void> {
  await tmux(["switch-client", "-c", client, "-t", target]);
}

export async function attach(target: string): Promise<number> {
  return runInteractive(TMUX_BIN, tmuxArgs(["attach-session", "-t", target]));
}

export async function killSession(name: string): Promise<void> {
  await tmux(["kill-session", "-t", `=${name}`]);
}

export async function displayMessage(client: string | undefined, msg: string): Promise<void> {
  const args = ["display-message"];
  if (client) args.push("-c", client);
  args.push(msg);
  await run(TMUX_BIN, tmuxArgs(args));
}

export function attachArgv(target: string): string[] {
  return [TMUX_BIN, ...tmuxArgs(["attach-session", "-t", target])];
}
