import { describe, expect, test } from "bun:test";
import { editLaunch, editWindowName, parseEditFile, planEdit, type EditPlanInput } from "../src/plans/edit";

const base: EditPlanInput = {
  cwd: "/w/api",
  file: "src/a.ts",
  session: { name: "api", steps: [] },
  windowExists: false,
  ctx: { client: { kind: "switch", name: "/dev/ttys001" }, fromApp: true, cwdWhenMissing: "/home" },
};

describe("ws edit の引数", () => {
  test("--file が無い・空・NUL を含むときは受け付けない", () => {
    expect(parseEditFile("src/a.ts")).toBe("src/a.ts");
    expect(() => parseEditFile(undefined)).toThrow("--file");
    expect(() => parseEditFile("  ")).toThrow("--file");
    expect(() => parseEditFile("a\0b")).toThrow("--file");
  });
});

describe("editWindowName", () => {
  test("ファイル名が同じでもパスが違えば別のウィンドウ名になり、tmux の区切り（. と :）を含まない", () => {
    const a = editWindowName("src/a.ts");
    expect(a).toMatch(/^edit-a_ts-[0-9a-f]{6}$/);
    expect(editWindowName("lib/a.ts")).not.toBe(a);
    expect(editWindowName("src/a.ts")).toBe(a);
  });
});

describe("editLaunch", () => {
  test("EDITOR（無ければ vi）をシェルが起動し、ファイル名は $0 で渡す", () => {
    expect(editLaunch("src/a b.ts")).toEqual(["sh", "-c", 'exec ${EDITOR:-vi} "$0"', "src/a b.ts"]);
  });
  test("- で始まるファイル名はオプションに取られないよう ./ を付ける", () => {
    expect(editLaunch("-x.ts")[3]).toBe("./-x.ts");
  });
});

describe("planEdit", () => {
  test("ウィンドウが無ければ、エディターのウィンドウを作ってクライアントをそこへ移し、Ghostty を前に出す", () => {
    const steps = planEdit(base);
    const window = editWindowName("src/a.ts");
    expect(steps.map((s) => s.op)).toEqual(["openEditWindow", "switchClient", "focusGhostty"]);
    expect(steps[0]).toEqual({ op: "openEditWindow", session: "api", window, cwd: "/w/api", argv: editLaunch("src/a.ts") });
    expect(steps[1]).toEqual({ op: "switchClient", client: "/dev/ttys001", target: `api:${window}` });
  });

  test("tmux セッションが無ければ先に作る", () => {
    const steps = planEdit({ ...base, session: { name: "api", steps: [{ op: "newSession", name: "api", cwd: "/w/api" }] } });
    expect(steps.map((s) => s.op)).toEqual(["newSession", "openEditWindow", "switchClient", "focusGhostty"]);
  });

  test("同じファイルのウィンドウが既にあれば、起動し直さず（エディターを止めず）そこへ移るだけ", () => {
    expect(planEdit({ ...base, windowExists: true }).map((s) => s.op)).toEqual(["switchClient", "focusGhostty"]);
  });

  test("--from-app でなければ Ghostty を前に出さない", () => {
    expect(planEdit({ ...base, ctx: { ...base.ctx, fromApp: false } }).map((s) => s.op)).toEqual(["openEditWindow", "switchClient"]);
  });
});
