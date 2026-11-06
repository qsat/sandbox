import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { candidates, filterCandidates, moveCursor, pickAction, shortWorkspace, subsequenceSpan, type Candidate } from "../src/workspace-picker/candidates";
import { wsNewArgs } from "../src/shared/ws-new";
import { readReveal, unfold } from "../src/shared/board-reveal";

const wt = (path: string, branch: string | null, exists = true, agents = 0) =>
  ({ path, branch, exists, isMain: false, tmux: { session: null, panes: [] }, agents: Array.from({ length: agents }, () => ({})) }) as unknown as ListedTree["workspaces"][number]["worktrees"][number];

const list = {
  usage: {},
  workspaces: [
    { path: "/g/o/api", name: "github.com/o/api", worktrees: [wt("/g/o/api", "main", true, 1), wt("/g/o/api=feat", "feat/login"), wt("/g/o/api=gone", "gone", false)] },
    { path: "/g/o/web", name: "github.com/o/web", worktrees: [wt("/g/o/web", null)] },
  ],
} as unknown as ListedTree;

/** agent-board が出している一覧（ws list --json）。api の main だけが出ている */
const board = { usage: {}, workspaces: [{ path: "/g/o/api", name: "github.com/o/api", worktrees: [wt("/g/o/api", "main", true, 1)] }] } as unknown as ListedTree;

const c = (workspace: string, worktree: string, onBoard = false): Candidate => ({ path: `/${workspace}/${worktree}`, workspace, worktree, agents: 0, workspacePath: `/${workspace}`, onBoard });
const names = (items: Candidate[]) => items.map((x) => `${x.workspace} ${x.worktree}`);

describe("candidates", () => {
  test("場所が在る worktree を ws list の並びで候補にする。名前はブランチ、無ければフォルダー名。ボードにあるものに印", () => {
    expect(candidates(list, board)).toEqual([
      { path: "/g/o/api", workspace: "github.com/o/api", worktree: "main", agents: 1, workspacePath: "/g/o/api", onBoard: true },
      { path: "/g/o/api=feat", workspace: "github.com/o/api", worktree: "feat/login", agents: 0, workspacePath: "/g/o/api", onBoard: false },
      { path: "/g/o/web", workspace: "github.com/o/web", worktree: "web", agents: 0, workspacePath: "/g/o/web", onBoard: false },
    ]);
  });
});

describe("pickAction", () => {
  test("ボードにある worktree は、起動せずにその行を選ぶ", () =>
    expect(pickAction(c("github.com/o/api", "main", true))).toEqual({ kind: "reveal", path: "/github.com/o/api/main", workspacePath: "/github.com/o/api" }));
  test("ボードに無い worktree は、claude を起動してボードに出す", () =>
    expect(pickAction(c("github.com/o/api", "feat"))).toEqual({ kind: "launch", args: ["new", "/github.com/o/api/feat", "--attach", "--from-app"] }));
});

describe("board-reveal", () => {
  test("頼みは path と at がそろっているときだけ読む", () => {
    expect(readReveal({ path: "/g/o/api", at: 5 })).toEqual({ path: "/g/o/api", at: 5 });
    expect(readReveal({ path: "/g/o/api" })).toBeNull();
    expect(readReveal(undefined)).toBeNull();
  });
  test("頼まれた worktree の workspace を、畳んだ一覧から外す", () => expect(unfold(["/g/o/api", "/g/o/web"], "/g/o/api")).toEqual(["/g/o/web"]));
});

describe("subsequenceSpan", () => {
  test("飛び飛びでも順に含まれれば、当てはまった範囲の長さを返す", () => {
    expect(subsequenceSpan("compass-wiki", "cw")).toBe(9);
    expect(subsequenceSpan("compass-wiki", "wiki")).toBe(4);
  });
  test("順に含まれなければ null", () => expect(subsequenceSpan("compass", "sc")).toBeNull());
  test("大文字と小文字は区別しない", () => expect(subsequenceSpan("Compass", "cOM")).toBe(3));
  test("いちばん短い範囲をとる", () => expect(subsequenceSpan("a-x-ab", "ab")).toBe(2));
});

describe("filterCandidates", () => {
  const items = [c("github.com/creal/compass", "main"), c("github.com/creal/compass-wiki", "main"), c("github.com/qsat/sandbox", "main")];

  test("何も打っていなければ元の並び", () => expect(filterCandidates(items, "  ")).toEqual(items));
  test("当てはまらない候補は外す", () => expect(names(filterCandidates(items, "sandbox"))).toEqual(["github.com/qsat/sandbox main"]));
  test("まとまって当てはまる候補を先に並べる", () =>
    expect(names(filterCandidates([c("o/x", "a-b-c"), c("o/x", "abc")], "abc"))).toEqual(["o/x abc", "o/x a-b-c"]));
  test("空白で区切った語は、すべてに当てはまる候補だけ残す", () =>
    expect(names(filterCandidates([c("github.com/o/api", "main"), c("github.com/o/api", "feat/login")], "api login"))).toEqual(["github.com/o/api feat/login"]));
});

describe("moveCursor", () => {
  test("端では反対の端へ回る", () => {
    expect(moveCursor(2, 3, 1)).toBe(0);
    expect(moveCursor(0, 3, -1)).toBe(2);
  });
  test("候補が無ければ 0", () => expect(moveCursor(0, 0, 1)).toBe(0));
});

describe("wsNewArgs", () => {
  test("agent-board の「＋ claude」と同じく、起動して会話へ移る", () =>
    expect(wsNewArgs("/g/o/api")).toEqual(["new", "/g/o/api", "--attach", "--from-app"]));
});

describe("shortWorkspace", () => {
  test("先頭のホスト名を省く", () => expect(shortWorkspace("github.com/creal/compass-wiki")).toBe("creal/compass-wiki"));
  test("区切りが 2 つ未満ならそのまま", () => expect(shortWorkspace("local/repo")).toBe("local/repo"));
});
