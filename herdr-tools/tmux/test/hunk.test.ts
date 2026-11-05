import { describe, expect, test } from "bun:test";
import { planHunk, type HunkPlanInput } from "../src/plans/hunk";

const base: HunkPlanInput = {
  cwd: "/w/api",
  hunkBin: "/opt/homebrew/bin/hunk",
  commit: "abc123",
  file: "src/a.ts",
  session: { name: "api", steps: [] },
  windowExists: false,
  hunkSessionExists: false,
  ctx: { client: { kind: "switch", name: "/dev/ttys001" }, fromApp: true, cwdWhenMissing: "/home" },
};
const ops = (i: Partial<HunkPlanInput>) => planHunk({ ...base, ...i }).map((s) => s.op);

describe("planHunk", () => {
  test("hunk のセッションがあれば、reload → hunk ウィンドウへ移る → navigate（待たない）", () => {
    const steps = planHunk({ ...base, hunkSessionExists: true, windowExists: true });
    expect(steps.map((s) => s.op)).toEqual(["hunkReload", "switchClient", "focusGhostty", "hunkNavigate"]);
    expect(steps[0]).toEqual({ op: "hunkReload", cwd: "/w/api", hunkBin: "/opt/homebrew/bin/hunk", args: ["show", "abc123"] });
    expect(steps[1]).toEqual({ op: "switchClient", client: "/dev/ttys001", target: "api:hunk" });
    expect(steps[3]).toEqual({ op: "hunkNavigate", cwd: "/w/api", file: "src/a.ts", wait: false });
  });

  test("セッションがあって hunk ウィンドウが無ければ、入れ替えと navigate だけ（移らない）", () => {
    expect(ops({ hunkSessionExists: true, windowExists: false })).toEqual(["hunkReload", "hunkNavigate"]);
  });

  test("未コミットの変更は hunk diff", () => {
    const steps = planHunk({ ...base, commit: undefined, hunkSessionExists: true, windowExists: true });
    expect(steps[0]).toMatchObject({ op: "hunkReload", args: ["diff"] });
  });

  test("ウィンドウもセッションも無ければ、tmux セッションを作り、hunk ウィンドウで起動し、起動を待って navigate", () => {
    const steps = planHunk({ ...base, session: { name: "api", steps: [{ op: "newSession", name: "api", cwd: "/w/api" }] } });
    expect(steps.map((s) => s.op)).toEqual(["newSession", "openHunkWindow", "switchClient", "focusGhostty", "hunkNavigate"]);
    expect(steps[1]).toEqual({ op: "openHunkWindow", session: "api", cwd: "/w/api", argv: ["/opt/homebrew/bin/hunk", "show", "abc123"] });
    expect(steps[4]).toMatchObject({ op: "hunkNavigate", wait: true });
  });

  test("ウィンドウはあるがセッションが無ければ、そのペインを作り直して起動し、待って navigate", () => {
    const steps = planHunk({ ...base, windowExists: true, hunkSessionExists: false });
    expect(steps.map((s) => s.op)).toEqual(["respawnHunkWindow", "switchClient", "focusGhostty", "hunkNavigate"]);
    expect(steps[0]).toEqual({ op: "respawnHunkWindow", session: "api", cwd: "/w/api", argv: ["/opt/homebrew/bin/hunk", "show", "abc123"] });
    expect(steps[3]).toMatchObject({ wait: true });
  });

  test("file が無ければ navigate しない", () => {
    expect(ops({ file: undefined, hunkSessionExists: true, windowExists: true })).toEqual(["hunkReload", "switchClient", "focusGhostty"]);
  });
});
