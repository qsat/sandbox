import { describe, expect, test } from "bun:test";
import { markCurrentPanes, type PaneLine } from "../src/current-pane";

const pane = (paneId: string, session: string, active: boolean): PaneLine => ({ paneId, agentId: null, dead: false, session, window: "main", command: "zsh", active });
const currentIds = (panes: PaneLine[], clients: { name: string; activity: number; session: string }[]) =>
  markCurrentPanes(panes, clients)
    .filter((p) => p.current)
    .map((p) => p.paneId);

describe("markCurrentPanes", () => {
  const panes = [pane("%1", "api", true), pane("%2", "api", false), pane("%3", "web", true), pane("%4", "docs", true)];

  test("クライアントが 2 つで別のセッションを見ていても、最後に操作したクライアントのペインだけを今いるペインにする", () => {
    const clients = [
      { name: "/dev/ttys001", activity: 100, session: "api" },
      { name: "/dev/ttys002", activity: 200, session: "web" },
    ];
    expect(currentIds(panes, clients)).toEqual(["%3"]);
  });

  test("セッションのアクティブでないペインは、今いるペインにしない", () => {
    expect(currentIds(panes, [{ name: "/dev/ttys001", activity: 100, session: "api" }])).toEqual(["%1"]);
  });

  test("クライアントが無ければ、どのペインも今いるペインにしない", () => {
    expect(currentIds(panes, [])).toEqual([]);
  });

  test("active は結果に残さない", () => {
    expect(markCurrentPanes([pane("%1", "api", true)], [])[0]).not.toHaveProperty("active");
  });
});
