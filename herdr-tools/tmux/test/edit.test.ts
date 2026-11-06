import { describe, expect, test } from "bun:test";
import { absoluteFile, editLaunch, editSocketPath, editWindowName, parseEditFile, planEdit, serverEditorBin, serverLaunch, SHARED_EDIT_WINDOW, type EditPlanInput } from "../src/plans/edit";

const base: EditPlanInput = {
  cwd: "/w/api",
  file: "src/a.ts",
  session: { name: "api", steps: [] },
  editor: "nvim",
  socket: "/c/nvim/api-1.sock",
  sharedWindowExists: false,
  serverResponds: false,
  fileWindowExists: false,
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

describe("nvim のサーバー", () => {
  test("EDITOR が nvim のときだけサーバーの機能を使う（絶対パス・引数付きも nvim。vim や空は使わない）", () => {
    expect(serverEditorBin("nvim")).toBe("nvim");
    expect(serverEditorBin("/opt/homebrew/bin/nvim -u NONE")).toBe("/opt/homebrew/bin/nvim");
    expect(serverEditorBin("vim")).toBeUndefined();
    expect(serverEditorBin("")).toBeUndefined();
  });
  test("ソケットのパスはセッションごとに決まり、別のセッション名なら別になり、長いセッション名でも短い", () => {
    const a = editSocketPath("/c/nvim/", "api=feat-auth");
    expect(a).toMatch(/^\/c\/nvim\/api_feat-auth-[0-9a-f]{6}\.sock$/);
    expect(editSocketPath("/c/nvim", "api=feat-auth")).toBe(a);
    expect(editSocketPath("/c/nvim", "api=feat_auth")).not.toBe(a);
    expect(editSocketPath("/c/nvim", "x".repeat(200)).length).toBeLessThan(70);
  });
  test("相対パスは worktree のパスを付けた絶対パスにし、絶対パスはそのまま", () => {
    expect(absoluteFile("/w/api", "src/a.ts")).toBe("/w/api/src/a.ts");
    expect(absoluteFile("/w/api/", "./src/a.ts")).toBe("/w/api/src/a.ts");
    expect(absoluteFile("/w/api", "/x/a.ts")).toBe("/x/a.ts");
  });
  test("起動のコマンドは、残ったソケットのファイルを消してから --listen で起動し、パスは位置引数で渡す", () => {
    expect(serverLaunch("/s.sock", "a b.ts")).toEqual(["sh", "-c", 'rm -f "$0"; exec ${EDITOR:-vi} --listen "$0" "$1"', "/s.sock", "a b.ts"]);
    expect(serverLaunch("/s.sock", "-x")[4]).toBe("./-x");
  });
});

describe("planEdit（nvim。セッションごとに 1 つのウィンドウを使い回す）", () => {
  test("ウィンドウもソケットの nvim も無ければ、edit ウィンドウで nvim --listen を起動し、クライアントを移し、Ghostty を前に出す", () => {
    const steps = planEdit(base);
    expect(steps.map((s) => s.op)).toEqual(["openEditWindow", "switchClient", "focusGhostty"]);
    expect(steps[0]).toEqual({ op: "openEditWindow", session: "api", window: SHARED_EDIT_WINDOW, cwd: "/w/api", argv: serverLaunch("/c/nvim/api-1.sock", "src/a.ts") });
    expect(steps[1]).toEqual({ op: "switchClient", client: "/dev/ttys001", target: `api:${SHARED_EDIT_WINDOW}` });
  });

  test("tmux セッションが無ければ先に作る", () => {
    const steps = planEdit({ ...base, session: { name: "api", steps: [{ op: "newSession", name: "api", cwd: "/w/api" }] } });
    expect(steps.map((s) => s.op)).toEqual(["newSession", "openEditWindow", "switchClient", "focusGhostty"]);
  });

  test("ウィンドウがあり nvim が応答すれば、ウィンドウを作らず --remote で開かせ、クライアントをそのウィンドウへ移す", () => {
    const steps = planEdit({ ...base, sharedWindowExists: true, serverResponds: true });
    expect(steps).toEqual([
      { op: "remoteEdit", bin: "nvim", socket: "/c/nvim/api-1.sock", file: "/w/api/src/a.ts" },
      { op: "switchClient", client: "/dev/ttys001", target: `api:${SHARED_EDIT_WINDOW}` },
      { op: "focusGhostty" },
    ]);
  });

  test("--from-app でなければ Ghostty を前に出さない", () => {
    const steps = planEdit({ ...base, sharedWindowExists: true, serverResponds: true, ctx: { ...base.ctx, fromApp: false } });
    expect(steps.map((s) => s.op)).toEqual(["remoteEdit", "switchClient"]);
  });

  test("ウィンドウはあるが nvim が応答しなければ、どの nvim も止めず、ファイルごとのウィンドウで開く", () => {
    const steps = planEdit({ ...base, sharedWindowExists: true, serverResponds: false });
    expect(steps.map((s) => s.op)).toEqual(["openEditWindow", "switchClient", "focusGhostty"]);
    expect(steps[0]).toMatchObject({ window: editWindowName("src/a.ts"), argv: editLaunch("src/a.ts") });
  });

  test("ウィンドウは無いのに nvim が応答するときも、そのソケットを奪わず、ファイルごとのウィンドウで開く", () => {
    const steps = planEdit({ ...base, sharedWindowExists: false, serverResponds: true });
    expect(steps[0]).toMatchObject({ op: "openEditWindow", window: editWindowName("src/a.ts") });
  });
});

describe("planEdit（nvim でないエディター。ファイルごとのウィンドウ）", () => {
  const vim = { ...base, editor: "vim" };

  test("ウィンドウが無ければ、ファイル専用のウィンドウで EDITOR を起動してクライアントを移す", () => {
    const steps = planEdit(vim);
    const window = editWindowName("src/a.ts");
    expect(steps.map((s) => s.op)).toEqual(["openEditWindow", "switchClient", "focusGhostty"]);
    expect(steps[0]).toEqual({ op: "openEditWindow", session: "api", window, cwd: "/w/api", argv: editLaunch("src/a.ts") });
    expect(steps[1]).toEqual({ op: "switchClient", client: "/dev/ttys001", target: `api:${window}` });
  });

  test("ソケットのパスが長すぎるときも、サーバーは使わない", () => {
    expect(planEdit({ ...base, socket: `/${"x".repeat(100)}.sock` })[0]).toMatchObject({ window: editWindowName("src/a.ts") });
  });

  test("EDITOR が空でも同じ", () => {
    expect(planEdit({ ...base, editor: "" })[0]).toMatchObject({ window: editWindowName("src/a.ts") });
  });

  test("同じファイルのウィンドウが既にあれば、起動し直さず（エディターを止めず）そこへ移るだけ", () => {
    expect(planEdit({ ...vim, fileWindowExists: true }).map((s) => s.op)).toEqual(["switchClient", "focusGhostty"]);
  });

  test("nvim が応答していても、EDITOR が vim ならサーバーは使わない", () => {
    expect(planEdit({ ...vim, sharedWindowExists: true, serverResponds: true })[0]).toMatchObject({ op: "openEditWindow" });
  });
});
