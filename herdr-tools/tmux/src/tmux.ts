// tmux コマンドとの境界。ペインオプションに 3.0 以上、display-popup に 3.2 以上が必要。

import { run, runOk, runInteractive } from "@herdr-tools/ws-core";
import { AGENT_PANE_OPTION, type TmuxClient, type TmuxFacts, type TmuxPane, type TmuxSession } from "./model";

// tmux は -F の出力中のタブなど制御文字を _ に置き換えるので、印字可能な区切りを使う
const SEP = "|@@|";

export interface TmuxOptions {
  bin?: string;
  /** 別サーバを使う（-L name）。テスト用 */
  socket?: string;
}

export class Tmux {
  readonly bin: string;
  private readonly socket?: string;

  constructor(opts: TmuxOptions = {}) {
    this.bin = opts.bin ?? "tmux";
    this.socket = opts.socket;
  }

  argv(args: string[]): string[] {
    return this.socket ? ["-L", this.socket, ...args] : args;
  }

  private exec(args: string[]): Promise<string> {
    return runOk(this.bin, this.argv(args));
  }

  /** サーバが動いていなければ空として扱う */
  private async lines(args: string[]): Promise<string[]> {
    const r = await run(this.bin, this.argv(args));
    if (r.code !== 0) return [];
    return r.stdout.split("\n").filter((l) => l.length > 0);
  }

  async facts(): Promise<TmuxFacts> {
    const [sessions, panes] = await Promise.all([this.listSessions(), this.listPanes()]);
    return { sessions, panes };
  }

  async listSessions(): Promise<TmuxSession[]> {
    const lines = await this.lines(["list-sessions", "-F", ["#{session_name}", "#{session_path}", "#{session_attached}"].join(SEP)]);
    return lines.map((l) => {
      const [name = "", path = "", attached = "0"] = l.split(SEP);
      return { name, path, attached: Number(attached) > 0 };
    });
  }

  async listPanes(): Promise<TmuxPane[]> {
    const fmt = ["#{session_name}", "#{window_index}", "#{window_name}", "#{pane_id}", `#{${AGENT_PANE_OPTION}}`, "#{pane_dead}", "#{pane_current_path}"].join(SEP);
    const lines = await this.lines(["list-panes", "-a", "-F", fmt]);
    return lines.map((l) => {
      const [session = "", wi = "0", windowName = "", paneId = "", agent = "", dead = "0", currentPath = ""] = l.split(SEP);
      return { session, windowIndex: Number(wi), windowName, paneId, agent: agent || null, dead: dead === "1", currentPath };
    });
  }

  async listClients(): Promise<TmuxClient[]> {
    const lines = await this.lines(["list-clients", "-F", ["#{client_activity}", "#{client_name}", "#{client_session}"].join(SEP)]);
    return lines.map((l) => {
      const [activity = "0", name = "", session = ""] = l.split(SEP);
      return { activity: Number(activity), name, session };
    });
  }

  /** tmux の中から呼ばれたとき、その端末のクライアント名 */
  async currentClient(env: Record<string, string | undefined>): Promise<string | undefined> {
    if (!env.TMUX) return undefined;
    const r = await run(this.bin, this.argv(["display-message", "-p", "#{client_name}"]));
    const name = r.stdout.trim();
    return r.code === 0 && name ? name : undefined;
  }

  async paneInfo(paneId: string): Promise<{ session: string; currentPath: string } | undefined> {
    const r = await run(this.bin, this.argv(["display-message", "-p", "-t", paneId, `#{session_name}${SEP}#{pane_current_path}`]));
    if (r.code !== 0) return undefined;
    const [session = "", currentPath = ""] = r.stdout.trim().split(SEP);
    return { session, currentPath };
  }

  async newSession(name: string, cwd: string): Promise<void> {
    await this.exec(["new-session", "-d", "-s", name, "-c", cwd]);
  }

  async hasWindow(session: string, window: string): Promise<boolean> {
    return (await this.lines(["list-windows", "-t", `=${session}`, "-F", "#{window_name}"])).includes(window);
  }

  /** 会話ペインを作る（ウィンドウが無ければウィンドウごと）。@ws_agent を付けてペインIDを返す */
  async openAgentPane(session: string, window: string, cwd: string, agent: string, command: string): Promise<string> {
    let paneId: string;
    if (await this.hasWindow(session, window)) {
      paneId = (await this.exec(["split-window", "-d", "-t", `=${session}:${window}`, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim();
      await this.exec(["select-layout", "-t", `=${session}:${window}`, "tiled"]);
    } else {
      paneId = (await this.exec(["new-window", "-d", "-t", `=${session}:`, "-n", window, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim();
    }
    await this.exec(["set-option", "-p", "-t", paneId, AGENT_PANE_OPTION, agent]);
    await this.selectPane(paneId);
    return paneId;
  }

  async selectPane(paneId: string): Promise<void> {
    await this.exec(["select-window", "-t", paneId]);
    await this.exec(["select-pane", "-t", paneId]);
  }

  async switchClient(client: string, target: string): Promise<void> {
    await this.exec(["switch-client", "-c", client, "-t", target]);
  }

  attach(target: string): Promise<number> {
    return runInteractive(this.bin, this.argv(["attach-session", "-t", target]));
  }

  attachArgv(target: string): string[] {
    return [this.bin, ...this.argv(["attach-session", "-t", target])];
  }

  async killSession(name: string): Promise<void> {
    await this.exec(["kill-session", "-t", `=${name}`]);
  }
}
