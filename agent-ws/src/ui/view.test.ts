import { expect, test } from "bun:test";
import { formatCells } from "./terminal.ts";
import { statusLine } from "./view.ts";

test("statusLine: 対応が要るものの有無だけを出し、何も無ければ空", () => {
  const line = (f: Partial<Parameters<typeof statusLine>[0]>) =>
    formatCells(statusLine({ waiting: false, asking: false, unseen: false, error: false, ...f }), "none");
  expect(line({})).toBe("");
  expect(line({ waiting: true, unseen: true })).toBe("⏳ ✓");
  expect(line({ asking: true, error: true })).toBe("❓ ✗");
});
