import { expect, test } from "bun:test";
import type { Pane } from "../types/navigation.ts";
import { detectAgent } from "./detectAgent.ts";
import { findPane } from "./findPane.ts";
import { repoName } from "./repoName.ts";

test("detectAgent: 実行ファイル名・ランタイム経由のスクリプトで判定する", () => {
  expect(detectAgent("claude --resume")).toBe("claude");
  expect(detectAgent("node /x/node_modules/@openai/codex/bin/codex.js")).toBe("codex");
  expect(detectAgent("/bin/bash -c exec -a claude sleep 30")).toBeNull(); // 引数中の名前には反応しない
});

test("repoName: ghq root からの相対名", () => {
  expect(repoName("/g/github.com/acme/api", ["/g"])).toBe("github.com/acme/api");
  expect(repoName("/elsewhere/api", ["/g"])).toBe("/elsewhere/api");
});

test("findPane: pid の祖先 → パスの順で探す", () => {
  const pane = (id: string, pid: number, path: string): Pane => ({ id, pid, path, session: "s", window: "0", windowName: "w", active: false });
  const panes = [pane("%1", 100, "/w/a"), pane("%2", 200, "/w/b")];
  const parent = new Map([[300, 250], [250, 200]]);
  expect(findPane({ title: "", name: "", pid: 300 }, panes, (p) => parent.get(p))?.id).toBe("%2");
  expect(findPane({ title: "", name: "", path: "/w/a" }, panes, () => undefined)?.id).toBe("%1");
});
