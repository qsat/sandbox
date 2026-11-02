import { run } from "@herdr-tools/utils/run";
import { runInteractive } from "@herdr-tools/utils/run-interactive";
import { runOk } from "@herdr-tools/utils/run-ok";

export const AGENT_PANE_OPTION = "@ws_agent";

// tmux は -F の出力中のタブなどの制御文字を _ に置き換えるので、印字できる区切りを使う
const FIELD_SEPARATOR = "|@@|";
const format = (...fields: string[]) => fields.join(FIELD_SEPARATOR);
const fields = (line: string) => line.split(FIELD_SEPARATOR);
const exact = (target: string) => (target.startsWith("%") || target.startsWith("=") ? target : `=${target}`);

export class TmuxServer {
  readonly bin: string;
  private readonly socketName?: string;

  constructor(opts: { bin?: string; socketName?: string } = {}) {
    this.bin = opts.bin ?? "tmux";
    this.socketName = opts.socketName;
  }

  private argv(args: string[]) {
    return this.socketName ? ["-L", this.socketName, ...args] : args;
  }

  private exec(args: string[]) {
    return runOk(this.bin, this.argv(args));
  }

  private async linesOrNoneWhenServerIsDown(args: string[]) {
    const r = await run(this.bin, this.argv(args));
    return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
  }

  async facts() {
    const [sessions, panes] = await Promise.all([this.listSessions(), this.listPanes()]);
    return { sessions, panes };
  }

  async listSessions() {
    const lines = await this.linesOrNoneWhenServerIsDown(["list-sessions", "-F", format("#{session_name}", "#{session_path}", "#{session_attached}")]);
    return lines.map((l) => {
      const [name = "", path = "", attached = "0"] = fields(l);
      return { name, path, attached: Number(attached) > 0 };
    });
  }

  async listPanes() {
    const lines = await this.linesOrNoneWhenServerIsDown(["list-panes", "-a", "-F", format("#{pane_id}", `#{${AGENT_PANE_OPTION}}`, "#{pane_dead}")]);
    return lines.map((l) => {
      const [paneId = "", agentId = "", dead = "0"] = fields(l);
      return { paneId, agentId: agentId || null, dead: dead === "1" };
    });
  }

  async listClients() {
    const lines = await this.linesOrNoneWhenServerIsDown(["list-clients", "-F", format("#{client_activity}", "#{client_name}")]);
    return lines.map((l) => {
      const [activity = "0", name = ""] = fields(l);
      return { activity: Number(activity), name };
    });
  }

  async callerClient(env: Record<string, string | undefined>) {
    if (!env.TMUX) return undefined;
    const r = await run(this.bin, this.argv(["display-message", "-p", "#{client_name}"]));
    return (r.code === 0 && r.stdout.trim()) || undefined;
  }

  async paneInfo(paneId: string) {
    const r = await run(this.bin, this.argv(["display-message", "-p", "-t", paneId, format("#{session_name}", "#{pane_current_path}")]));
    if (r.code !== 0) return undefined;
    const [session = "", currentPath = ""] = fields(r.stdout.trim());
    return { session, currentPath };
  }

  async newSession(name: string, cwd: string) {
    await this.exec(["new-session", "-d", "-s", name, "-c", cwd]);
  }

  private async hasWindow(session: string, window: string) {
    return (await this.linesOrNoneWhenServerIsDown(["list-windows", "-t", exact(session), "-F", "#{window_name}"])).includes(window);
  }

  async openAgentPane(session: string, window: string, cwd: string, agentId: string, command: string) {
    const windowTarget = `${exact(session)}:${window}`;
    const paneId = (await this.hasWindow(session, window))
      ? (await this.exec(["split-window", "-d", "-t", windowTarget, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim()
      : (await this.exec(["new-window", "-d", "-t", `${exact(session)}:`, "-n", window, "-c", cwd, "-P", "-F", "#{pane_id}", command])).trim();
    await this.exec(["select-layout", "-t", windowTarget, "tiled"]);
    await this.markPaneAsConversation(paneId, agentId);
    await this.selectPane(paneId);
    return paneId;
  }

  async markPaneAsConversation(paneId: string, agentId: string) {
    await this.exec(["set-option", "-p", "-t", paneId, AGENT_PANE_OPTION, agentId]);
  }

  async unmarkPane(paneId: string) {
    await this.exec(["set-option", "-p", "-u", "-t", paneId, AGENT_PANE_OPTION]);
  }

  async selectPane(paneId: string) {
    await this.exec(["select-window", "-t", paneId]);
    await this.exec(["select-pane", "-t", paneId]);
  }

  async switchClient(client: string, target: string) {
    await this.exec(["switch-client", "-c", client, "-t", exact(target)]);
  }

  attachHere(target: string) {
    return runInteractive(this.bin, this.argv(["attach-session", "-t", exact(target)]));
  }

  attachArgv(target: string) {
    return [this.bin, ...this.argv(["attach-session", "-t", exact(target)])];
  }

  async killSession(name: string) {
    await this.exec(["kill-session", "-t", exact(name)]);
  }
}
