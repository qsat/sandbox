import { expect, test } from "bun:test";
import { detectAgent } from "../detectAgent.ts";

test("detectAgent: 実行ファイル名・ランタイム経由のスクリプトで判定する", () => {
  expect(detectAgent("claude --resume")).toBe("claude");
  expect(detectAgent("node /x/node_modules/@openai/codex/bin/codex.js")).toBe("codex");
  expect(detectAgent("/bin/bash -c exec -a claude sleep 30")).toBeNull(); // 引数中の名前には反応しない
});
