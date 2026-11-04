import { describe, expect, test } from "bun:test";
import { buildTree, type AgentRecord, type PathInspection } from "@herdr-tools/ws-core";
import { cycleCandidates, decideCurrentPane, isCycleStatus, messageWhenNoCandidate, nextCandidate } from "../src/plans/cycle";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat`;
const WEB = `${G}/web`;
const a = (p: Partial<AgentRecord> & { id: string }): AgentRecord => ({ name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p });
const infos: PathInspection[] = [API, FEAT, WEB].map((path) => ({ path, exists: true, toplevel: path, commonDir: `${path.split("=")[0]}/.git`, branch: "main" }));

const tree = buildTree({
  agents: [
    a({ id: "w2", cwd: WEB, status: "blocked" }),
    a({ id: "b3", cwd: FEAT, status: "blocked" }),
    a({ id: "b1", cwd: API, status: "blocked" }),
    a({ id: "b2", cwd: API, status: "blocked" }),
    a({ id: "dead", cwd: API, status: "blocked", alive: false }),
    a({ id: "work", cwd: API, status: "working" }),
    a({ id: "idle", cwd: API, status: "idle" }),
  ],
  inspections: infos,
  ghqRoot: "/Users/me/ghq",
  alwaysShow: [],
});
const ids = (s: "blocked" | "working" | "idle") => cycleCandidates(tree, s).map((c) => c.agent.id);

describe("巡回の候補", () => {
  test("status と alive で絞り、workspace → worktree → id の安定した順に並べる", () => {
    expect(ids("blocked")).toEqual(["b1", "b2", "b3", "w2"]);
    expect(ids("working")).toEqual(["work"]);
    expect(ids("idle")).toEqual(["idle"]);
  });
  test("巡回できる status は blocked / working / idle", () => {
    expect(["blocked", "working", "idle", "done", "toString"].map(isCycleStatus)).toEqual([true, true, true, false, false]);
  });
});

describe("次の候補", () => {
  const c = cycleCandidates(tree, "blocked");
  test("今のエージェントの次へ進む", () => expect(nextCandidate(c, "b1")?.agent.id).toBe("b2"));
  test("最後の候補からは先頭に戻る", () => expect(nextCandidate(c, "w2")?.agent.id).toBe("b1"));
  test("今いるペインが候補でなければ先頭へ移る", () => {
    expect(nextCandidate(c, "idle")?.agent.id).toBe("b1");
    expect(nextCandidate(c, null)?.agent.id).toBe("b1");
    expect(nextCandidate(c, undefined)?.agent.id).toBe("b1");
  });
  test("候補が無ければ移動先なし", () => {
    expect(nextCandidate([], "b1")).toBeUndefined();
    expect(nextCandidate([], undefined)).toBeUndefined();
  });
  test("候補が無いときの文言は status ごとに違う", () => {
    expect(messageWhenNoCandidate("blocked")).toBe("入力待ちのエージェントはありません");
    expect(messageWhenNoCandidate("working")).toBe("作業中のエージェントはありません");
    expect(messageWhenNoCandidate("idle")).toBe("待機中のエージェントはありません");
  });
});

describe("今いるペインの決め方", () => {
  const displayedPanes = ["%1", "%2"];
  test("--pane が最優先", () => expect(decideCurrentPane({ explicit: "%9", envPane: "%8", clientPane: "%2", displayedPanes })).toBe("%9"));
  test("--pane が無ければ TMUX_PANE", () => expect(decideCurrentPane({ envPane: "%8", clientPane: "%2", displayedPanes })).toBe("%8"));
  test("どちらも無ければ移動に使うクライアントが表示しているペイン", () => expect(decideCurrentPane({ clientPane: "%2", displayedPanes })).toBe("%2"));
  test("クライアントのペインも分からなければ表示中の最初のペイン", () => expect(decideCurrentPane({ displayedPanes })).toBe("%1"));
  test("何も無ければ undefined", () => expect(decideCurrentPane({ displayedPanes: [] })).toBeUndefined());
});
