import { expect, test } from "bun:test";
import type { Session } from "../domain.ts";
import { formatCells } from "./terminal.ts";
import { statusLine } from "./view.ts";

const session = (over: Partial<Session>): Session =>
  ({ id: "s", pid: 1, cwd: "/w", status: "running", since: 0, updated: 0, subagents: [], ...over });

test("statusLine: 対応が要るものの有無だけを出し、何も無ければ空", () => {
  const line = (...ss: Partial<Session>[]) => formatCells(statusLine(ss.map(session)), "none");
  expect(line({ status: "running" }, { status: "ready" })).toBe("");
  expect(line({ status: "waiting" }, { status: "waiting" }, { status: "ready", unseen: true })).toBe("⏳ ✓");
  expect(line({ status: "asking" }, { status: "error" })).toBe("❓ ✗");
});
