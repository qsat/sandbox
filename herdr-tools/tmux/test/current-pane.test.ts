import { describe, expect, test } from "bun:test";
import { markCurrentPanes, type PaneLine } from "../src/current-pane";
import type { TmuxClient } from "../src/facts";

const pane = (paneId: string, session: string, active: boolean): PaneLine => ({ paneId, agentId: null, dead: false, session, window: "main", command: "zsh", active });
const currentIds = (panes: PaneLine[], clients: TmuxClient[]) =>
  markCurrentPanes(panes, clients)
    .filter((p) => p.current)
    .map((p) => p.paneId);
const ghostty = (name: string, created: number, activity: number, session: string): TmuxClient => ({ name, created, activity, termname: "xterm-ghostty", session });
const other = (name: string, created: number, activity: number, session: string): TmuxClient => ({ name, created, activity, termname: "xterm-256color", session });

describe("markCurrentPanes", () => {
  const panes = [pane("%1", "api", true), pane("%2", "api", false), pane("%3", "web", true), pane("%4", "docs", true)];

  test("Ghostty のウインドウが 2 つで別のセッションを見ていても、最初につながったウインドウのペインだけを今いるペインにする", () => {
    expect(currentIds(panes, [ghostty("/dev/ttys001", 10, 100, "api"), ghostty("/dev/ttys002", 20, 200, "web")])).toEqual(["%1"]);
  });

  test("Ghostty のクライアントが無ければ、最後に操作したクライアントのペインを今いるペインにする", () => {
    expect(currentIds(panes, [other("/dev/ttys001", 10, 100, "api"), other("/dev/ttys002", 20, 200, "web")])).toEqual(["%3"]);
  });

  test("セッションのアクティブでないペインは、今いるペインにしない", () => {
    expect(currentIds(panes, [ghostty("/dev/ttys001", 10, 100, "api")])).toEqual(["%1"]);
  });

  test("クライアントが無ければ、どのペインも今いるペインにしない", () => {
    expect(currentIds(panes, [])).toEqual([]);
  });

  test("active は結果に残さない", () => {
    expect(markCurrentPanes([pane("%1", "api", true)], [])[0]).not.toHaveProperty("active");
  });
});
