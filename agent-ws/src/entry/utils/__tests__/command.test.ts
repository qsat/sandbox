import { expect, test } from "bun:test";
import { parseCommand } from "../command.ts";
import { contextOf } from "../context.ts";

const filter = { all: false, agentsOnly: false };

test("サブコマンドが無ければ list（最初の引数は絞り込み）", () => {
  expect(parseCommand([], "/w")).toEqual({ kind: "list", query: undefined, filter, json: false });
  expect(parseCommand(["api", "--json"], "/w")).toEqual({ kind: "list", query: "api", filter, json: true });
});

test("jump は数字なら pid、それ以外はパス、省けばいまの場所", () => {
  expect(parseCommand(["jump", "42", "--dry-run"], "/w")).toMatchObject({ kind: "jump", target: { pid: 42 }, dryRun: true });
  expect(parseCommand(["jump", "/r"], "/w")).toMatchObject({ kind: "jump", target: { path: "/r" } });
  expect(parseCommand(["jump"], "/w")).toMatchObject({ kind: "jump", target: { path: "/w" } });
});

test("watch の interval は秒で受けてミリ秒にする", () => {
  expect(parseCommand(["watch", "--interval=5", "--popup"], "/w")).toMatchObject({ kind: "watch", intervalMs: 5000, popup: true });
});

test("解釈できない引数は使い方を返す", () => {
  expect(parseCommand(["seen", "x"], "/w").kind).toBe("usage");
  expect(parseCommand(["--nope"], "/w").kind).toBe("usage");
  expect(parseCommand(["seen", "123"], "/w")).toEqual({ kind: "seen", panePid: 123 });
});

test("環境変数はここでだけ読む: 既定値と、空の AGENT_WS_NOTIFY は知らせない", () => {
  const self = { pid: 10, ppid: 9, platform: "linux" };
  expect(contextOf({}, 1, self, "/h")).toEqual({
    ...self,
    now: 1,
    stateDir: "/h/.local/state/agent-ws/agents",
    ghq: { root: [], home: "/h" },
    notify: ["waiting", "asking", "ready", "error"],
    inTmux: false,
    dump: undefined,
  });
  expect(contextOf({ AGENT_WS_NOTIFY: "", TMUX: "/tmp/t,1,0", GHQ_ROOT: "/a:/b", XDG_STATE_HOME: "/s" }, 1, self, "/h")).toMatchObject({
    notify: [],
    inTmux: true,
    ghq: { root: ["/a", "/b"] },
    stateDir: "/s/agent-ws/agents",
  });
});

test("AGENT_WS_NOTIFY の知らない種類は無視する", () => {
  expect(contextOf({ AGENT_WS_NOTIFY: "ready,nope" }, 1, { pid: 1, ppid: 1, platform: "linux" }, "/h").notify).toEqual(["ready"]);
});
