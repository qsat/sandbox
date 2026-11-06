import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { candidates, filterCandidates, moveCursor, subsequenceSpan, wsNewArgs, type Candidate } from "../src/workspace-picker/candidates";

const wt = (path: string, branch: string | null, exists = true, agents = 0) =>
  ({ path, branch, exists, isMain: false, tmux: { session: null, panes: [] }, agents: Array.from({ length: agents }, () => ({})) }) as unknown as ListedTree["workspaces"][number]["worktrees"][number];

const list = {
  usage: {},
  workspaces: [
    { path: "/g/o/api", name: "github.com/o/api", worktrees: [wt("/g/o/api", "main", true, 1), wt("/g/o/api=feat", "feat/login"), wt("/g/o/api=gone", "gone", false)] },
    { path: "/g/o/web", name: "github.com/o/web", worktrees: [wt("/g/o/web", null)] },
  ],
} as unknown as ListedTree;

const c = (workspace: string, worktree: string): Candidate => ({ path: `/${workspace}/${worktree}`, workspace, worktree, agents: 0 });
const names = (items: Candidate[]) => items.map((x) => `${x.workspace} ${x.worktree}`);

describe("candidates", () => {
  test("場所が在る worktree を ws list の並びで候補にする。名前はブランチ、無ければフォルダー名", () => {
    expect(candidates(list)).toEqual([
      { path: "/g/o/api", workspace: "github.com/o/api", worktree: "main", agents: 1 },
      { path: "/g/o/api=feat", workspace: "github.com/o/api", worktree: "feat/login", agents: 0 },
      { path: "/g/o/web", workspace: "github.com/o/web", worktree: "web", agents: 0 },
    ]);
  });
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
    expect(wsNewArgs(c("github.com/o/api", "main"))).toEqual(["new", "/github.com/o/api/main", "--attach", "--from-app"]));
});
