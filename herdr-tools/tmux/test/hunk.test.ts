import { describe, expect, test } from "bun:test";
import { parseHunkSource, planHunk, type HunkPlanInput } from "../src/plans/hunk";

describe("ws hunk の引数", () => {
  test("--commit、--pr、--gh-commit はどれか 1 つ", () => {
    expect(parseHunkSource({ pr: "55" })).toEqual({ commit: undefined, pr: "55", ghCommit: undefined });
    expect(parseHunkSource({ ghCommit: "abc1234" }).ghCommit).toBe("abc1234");
    expect(parseHunkSource({ commit: "main~1" }).commit).toBe("main~1");
    expect(parseHunkSource({}).pr).toBeUndefined();
    expect(() => parseHunkSource({ pr: "1", commit: "abc" })).toThrow("同時");
    expect(() => parseHunkSource({ pr: "1", ghCommit: "abc1234" })).toThrow("同時");
  });
  test("--pr は数字、--gh-commit は 16 進数の sha だけ受け付ける", () => {
    expect(() => parseHunkSource({ pr: "5x" })).toThrow("--pr");
    expect(() => parseHunkSource({ pr: "" })).toThrow("--pr");
    expect(() => parseHunkSource({ ghCommit: "abc" })).toThrow("--gh-commit");
    expect(() => parseHunkSource({ ghCommit: "abc1234; rm" })).toThrow("--gh-commit");
  });
});

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

  const SCRIPT = (s: { argv: string[] }) => s.argv[2] ?? "";

  test("プルリクエスト: セッションがあっても reload せず、ウィンドウがあれば respawn-pane -k で hunk gh pr を起動し直す", () => {
    const steps = planHunk({ ...base, commit: undefined, file: undefined, pr: "55", hunkSessionExists: true, windowExists: true });
    expect(steps.map((s) => s.op)).toEqual(["respawnHunkWindow", "switchClient", "focusGhostty"]);
    expect(steps[0]).toMatchObject({ op: "respawnHunkWindow", session: "api", cwd: "/w/api" });
    expect((steps[0] as { argv: string[] }).argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect((steps[0] as { argv: string[] }).argv.slice(3)).toEqual(["/opt/homebrew/bin/hunk", "gh", "pr", "55"]);
  });

  test("プルリクエスト: ウィンドウが無ければ tmux セッションを作って hunk ウィンドウで起動する", () => {
    const steps = planHunk({ ...base, commit: undefined, file: undefined, pr: "55", session: { name: "api", steps: [{ op: "newSession", name: "api", cwd: "/w/api" }] } });
    expect(steps.map((s) => s.op)).toEqual(["newSession", "openHunkWindow", "switchClient", "focusGhostty"]);
    expect((steps[1] as { argv: string[] }).argv.slice(3)).toEqual(["/opt/homebrew/bin/hunk", "gh", "pr", "55"]);
  });

  test("GitHub のコミットは hunk gh commit <sha>", () => {
    const steps = planHunk({ ...base, commit: undefined, file: undefined, ghCommit: "abc1234", windowExists: true });
    expect((steps[0] as { argv: string[] }).argv.slice(3)).toEqual(["/opt/homebrew/bin/hunk", "gh", "commit", "abc1234"]);
  });

  test("GH_TOKEN はシェルが gh auth token から入れ、トークンの値もコマンドラインの引数にも出ない（hunk の引数は $0 と $@ で渡す）", () => {
    const step = planHunk({ ...base, commit: undefined, file: undefined, pr: "55", windowExists: true })[0] as { argv: string[] };
    const script = SCRIPT(step);
    expect(script).toContain("gh auth token");
    expect(script).toContain("export GH_TOKEN");
    expect(script).toContain('exec "$0" "$@"');
    expect(script).not.toContain("55");
  });

  test("手元のコミットは、これまでどおり hunk show の reload（GitHub の起動を使わない）", () => {
    const steps = planHunk({ ...base, hunkSessionExists: true, windowExists: true });
    expect(steps[0]).toMatchObject({ op: "hunkReload", args: ["show", "abc123"] });
  });

  test("file が無ければ navigate しない", () => {
    expect(ops({ file: undefined, hunkSessionExists: true, windowExists: true })).toEqual(["hunkReload", "switchClient", "focusGhostty"]);
  });
});
