import { describe, expect, test } from "bun:test";
import { buildTree, type AgentRecord, type PathInspection } from "@herdr-tools/ws-core";
import { cycleCandidates, decideCurrentPane, MESSAGE_WHEN_NO_CANDIDATE, nextCandidate, prevCandidate } from "../src/plans/cycle";

const G = "/Users/me/ghq/github.com/o";
const API = `${G}/api`;
const FEAT = `${G}/api=feat`;
const WEB = `${G}/web`;
const a = (p: Partial<AgentRecord> & { id: string }): AgentRecord => ({ name: p.id, cwd: API, status: "idle", alive: true, parent: null, ...p });
const infos: PathInspection[] = [API, FEAT, WEB].map((path) => ({ path, exists: true, toplevel: path, commonDir: `${path.split("=")[0]}/.git`, branch: "main" }));

const tree = buildTree({
  agents: [
    a({ id: "w2", cwd: WEB, status: "blocked", statusMs: 100 }),
    a({ id: "b3", cwd: FEAT, status: "blocked", statusMs: 300 }),
    a({ id: "b1", cwd: API, status: "blocked", statusMs: 200, blockedReason: "permission" }),
    a({ id: "b2", cwd: API, status: "blocked", statusMs: 200 }),
    a({ id: "dead", cwd: API, status: "blocked", alive: false }),
    a({ id: "work", cwd: API, status: "working" }),
    a({ id: "i1", cwd: API, status: "idle", statusMs: 900 }),
    a({ id: "i2", cwd: API, status: "idle", statusMs: 950 }),
    a({ id: "d1", cwd: WEB, status: "done", statusMs: 10 }),
    a({ id: "d2", cwd: WEB, status: "done", statusMs: 20 }),
    a({ id: "err", cwd: WEB, status: "error" }),
  ],
  inspections: infos,
  ghqRoot: "/Users/me/ghq",
  alwaysShow: [],
});
const c = cycleCandidates(tree);
const ids = c.map((x) => x.agent.id);

describe("巡回の列", () => {
  test("blocked → done → idle の順に並べ、working・error と alive でないものは除く", () => {
    expect(ids).toEqual(["b3", "b1", "b2", "w2", "d2", "d1", "i2", "i1"]);
  });
  test("同じ status の中は status になった時刻が新しい順で、同じ時刻は ID の順", () => {
    expect(ids.slice(0, 4)).toEqual(["b3", "b1", "b2", "w2"]);
    expect(ids.slice(4, 6)).toEqual(["d2", "d1"]);
  });
  test("時刻が取れないものは最後で、ID の順（t9 が t10 より先）", () => {
    const t = buildTree({
      agents: [a({ id: "t10", status: "idle" }), a({ id: "t9", status: "idle" }), a({ id: "t1", status: "idle", statusMs: 5 })],
      inspections: infos,
      ghqRoot: "/Users/me/ghq",
      alwaysShow: [],
    });
    expect(cycleCandidates(t).map((x) => x.agent.id)).toEqual(["t1", "t9", "t10"]);
  });
});

describe("前へ巡回する", () => {
  test("今のエージェントの次へ進む", () => expect(nextCandidate(c, "b3")?.agent.id).toBe("b1"));
  test("最後からは先頭に戻る", () => expect(nextCandidate(c, "i1")?.agent.id).toBe("b3"));
  test("列に無ければ先頭へ移る", () => {
    expect(nextCandidate(c, "work")?.agent.id).toBe("b3");
    expect(nextCandidate(c, null)?.agent.id).toBe("b3");
    expect(nextCandidate(c, undefined)?.agent.id).toBe("b3");
  });
  test("候補が無ければ移動先なし", () => {
    expect(nextCandidate([], "b1")).toBeUndefined();
    expect(nextCandidate([], undefined)).toBeUndefined();
  });
});

describe("後ろへ巡回する", () => {
  test("今のエージェントの 1 つ前へ戻る", () => expect(prevCandidate(c, "b1")?.agent.id).toBe("b3"));
  test("先頭からは最後へ回る", () => expect(prevCandidate(c, "b3")?.agent.id).toBe("i1"));
  test("列に無ければ最後へ移る", () => {
    expect(prevCandidate(c, "work")?.agent.id).toBe("i1");
    expect(prevCandidate(c, undefined)?.agent.id).toBe("i1");
  });
  test("候補が無ければ移動先なし", () => {
    expect(prevCandidate([], "b1")).toBeUndefined();
    expect(prevCandidate([], undefined)).toBeUndefined();
  });
  test("候補が無いときの文言", () => expect(MESSAGE_WHEN_NO_CANDIDATE).toBe("巡回するエージェントはありません"));
});

describe("今いるペインの決め方", () => {
  const displayedPanes = ["%1", "%2"];
  test("--pane が最優先", () => expect(decideCurrentPane({ explicit: "%9", envPane: "%8", clientPane: "%2", displayedPanes })).toBe("%9"));
  test("--pane が無ければ TMUX_PANE", () => expect(decideCurrentPane({ envPane: "%8", clientPane: "%2", displayedPanes })).toBe("%8"));
  test("どちらも無ければ移動に使うクライアントが表示しているペイン", () => expect(decideCurrentPane({ clientPane: "%2", displayedPanes })).toBe("%2"));
  test("クライアントのペインも分からなければ表示中の最初のペイン", () => expect(decideCurrentPane({ displayedPanes })).toBe("%1"));
  test("何も無ければ undefined", () => expect(decideCurrentPane({ displayedPanes: [] })).toBeUndefined());
});
