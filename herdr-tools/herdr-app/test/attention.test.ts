import { describe, expect, test } from "bun:test";
import { attentionChanges, attentionMessage, osascriptArgs } from "../src/agent-board/attention";
import type { BoardRow } from "../src/agent-board/board";

type AgentRow = Extract<BoardRow, { kind: "agent" }>;
const agentRow = (key: string, rawStatus: string, label = `claude ${key}`): AgentRow => ({ kind: "agent", key, label, rawStatus, worktree: "/g/o/api=feat" }) as AgentRow;
const worktreeRow = { kind: "worktree", key: "/g/o/api" } as BoardRow;
const keys = (rows: AgentRow[]) => rows.map((r) => r.key);

describe("attentionChanges", () => {
  test("最初の 1 回は、blocked や done があっても知らせず、status を覚えるだけ", () => {
    const r = attentionChanges(null, [agentRow("t1", "blocked"), agentRow("t2", "done"), worktreeRow]);
    expect(r.changed).toEqual([]);
    expect([...r.next]).toEqual([
      ["t1", "blocked"],
      ["t2", "done"],
    ]);
  });

  test("blocked か done に変わったエージェントだけを知らせる", () => {
    const prev = new Map([
      ["t1", "working"],
      ["t2", "working"],
      ["t3", "working"],
    ]);
    const r = attentionChanges(prev, [agentRow("t1", "blocked"), agentRow("t2", "done"), agentRow("t3", "idle")]);
    expect(keys(r.changed)).toEqual(["t1", "t2"]);
  });

  test("blocked や done のまま変わらなければ、もう一度は知らせない", () => {
    const prev = new Map([
      ["t1", "blocked"],
      ["t2", "done"],
    ]);
    expect(attentionChanges(prev, [agentRow("t1", "blocked"), agentRow("t2", "done")]).changed).toEqual([]);
  });

  test("blocked から done に変わったら知らせる", () => {
    expect(keys(attentionChanges(new Map([["t1", "blocked"]]), [agentRow("t1", "done")]).changed)).toEqual(["t1"]);
  });

  test("前回いなかったエージェントが blocked で現れたら知らせる", () => {
    expect(keys(attentionChanges(new Map(), [agentRow("t9", "blocked")]).changed)).toEqual(["t9"]);
  });
});

describe("attentionMessage", () => {
  test("題名にエージェントの名前と何が起きたか、本文に worktree のフォルダー名", () => {
    expect(attentionMessage(agentRow("t1", "blocked", "t1 api-feat"))).toEqual({ title: "t1 api-feat が待っています", body: "api=feat" });
    expect(attentionMessage(agentRow("t1", "done", "t1 api-feat"))).toEqual({ title: "t1 api-feat が終わりました", body: "api=feat" });
  });
});

describe("osascriptArgs", () => {
  test("題名と本文は argv で渡し、AppleScript の文字列に埋め込まない", () => {
    const args = osascriptArgs({ title: 'a "b"', body: "c" });
    expect(args.slice(-3)).toEqual(["--", 'a "b"', "c"]);
    expect(args.join(" ")).not.toContain('"b"" ');
  });
});
