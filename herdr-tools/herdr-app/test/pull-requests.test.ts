import { describe, expect, test } from "bun:test";
import { PR_LIST_ARGS, ghFailureMessage, parsePrCommits, parsePrList, prCommitsArgs, type PrCommit, type PullRequest } from "../src/pull-requests/gh";
import { visibleRows } from "../src/pull-requests/rows";
import { wsHunkArgs, wsHunkGithubCommitArgs, wsHunkPrArgs, wsHunkPrCommitArgs } from "../src/shared/ws-hunk";

describe("gh pr list の読み取り", () => {
  test("引数に取るフィールドと件数を指定する", () => {
    expect(PR_LIST_ARGS.slice(0, 6)).toEqual(["pr", "list", "--state", "open", "--limit", "30"]);
    expect(PR_LIST_ARGS.at(-1)).toBe("number,title,author,headRefName,baseRefName,isDraft,updatedAt,url");
  });
  test("空の一覧は 0 件。壊れた出力も 0 件", () => {
    expect(parsePrList("[]")).toEqual([]);
    expect(parsePrList("")).toEqual([]);
    expect(parsePrList("{}")).toEqual([]);
  });
  test("下書き・作者・更新日時（unix 秒）を読む", () => {
    const out = JSON.stringify([
      { number: 2, title: "B", author: { login: "bob", is_bot: false }, headRefName: "feat", baseRefName: "main", isDraft: true, updatedAt: "2026-11-05T09:49:34Z", url: "https://x/2" },
    ]);
    expect(parsePrList(out)).toEqual([{ number: 2, title: "B", author: "bob", headRef: "feat", baseRef: "main", isDraft: true, updatedAt: 1793872174, url: "https://x/2" }]);
  });
  test("作者が無い（null）ときは空の文字列。下書きの項目が無ければ false", () => {
    const [pr] = parsePrList(JSON.stringify([{ number: 3, title: "C", author: null, headRefName: "h", baseRefName: "b", updatedAt: "bad", url: "" }]));
    expect(pr).toMatchObject({ author: "", isDraft: false, updatedAt: 0 });
  });
  test("番号の無い項目は読み飛ばす", () => {
    expect(parsePrList(JSON.stringify([{ title: "x" }, { number: 1 }])).map((p) => p.number)).toEqual([1]);
  });
});

describe("gh pr view --json commits の読み取り", () => {
  test("コミットを取る引数", () => expect(prCommitsArgs(55)).toEqual(["pr", "view", "55", "--json", "commits"]));
  test("古い順の出力を新しい順にし、短いハッシュ・作者・件名・日時を読む", () => {
    const out = JSON.stringify({
      commits: [
        { oid: "aaaaaaaa1111", messageHeadline: "first", committedDate: "2026-11-05T09:00:00Z", authoredDate: "2026-11-05T08:00:00Z", authors: [{ login: "bob", name: "" }] },
        { oid: "bbbbbbbb2222", messageHeadline: "second", committedDate: "2026-11-05T10:00:00Z", authoredDate: "2026-11-05T10:00:00Z", authors: [{ login: "al", name: "Al" }] },
      ],
    });
    const commits = parsePrCommits(out);
    expect(commits.map((c) => [c.short, c.subject, c.author])).toEqual([
      ["bbbbbbb", "second", "Al"],
      ["aaaaaaa", "first", "bob"],
    ]);
    expect(commits[1]!.time).toBe(1793869200);
  });
  test("コミットが 0 件・作者が無いときも読める。壊れた出力は 0 件", () => {
    expect(parsePrCommits('{"commits":[]}')).toEqual([]);
    expect(parsePrCommits("nope")).toEqual([]);
    expect(parsePrCommits('{"commits":[{"oid":"abcdef0123","messageHeadline":"x","authors":[]}]}')[0]).toMatchObject({ author: "", time: 0 });
  });
});

describe("gh が失敗したときの文", () => {
  test("gh が無い", () => {
    expect(ghFailureMessage(null)).toBe("gh not found");
    expect(ghFailureMessage({ code: 127, stderr: "" })).toBe("gh not found");
  });
  test("認証が無い", () => expect(ghFailureMessage({ code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" })).toBe("gh is not logged in (run gh auth login)"));
  test("GitHub のリポジトリではない", () => {
    expect(ghFailureMessage({ code: 1, stderr: "none of the git remotes configured for this repository point to a known GitHub host." })).toBe("Not a GitHub repository");
  });
  test("見分けられない失敗は標準エラーの 1 行目を出す", () => expect(ghFailureMessage({ code: 1, stderr: "boom\nmore" })).toBe("gh pr list failed: boom"));
});

describe("プルリクエストの行の並び", () => {
  const pr = (number: number, headRef: string): PullRequest => ({ number, title: `t${number}`, author: "a", headRef, baseRef: "main", isDraft: false, updatedAt: 0, url: "" });
  const commit = (hash: string): PrCommit => ({ hash, short: hash.slice(0, 7), author: "a", time: 0, subject: hash });
  test("今のブランチのプルリクエストを先頭に置く", () => {
    const rows = visibleRows([pr(1, "x"), pr(2, "mine"), pr(3, "y")], "mine", null, new Map());
    expect(rows.map((r) => r.id)).toEqual(["pr:2", "pr:1", "pr:3"]);
    expect(rows[0]).toMatchObject({ current: true });
  });
  test("開いたプルリクエストの下にコミットが並ぶ。読み込み中・0 件はその旨の行", () => {
    const prs = [pr(1, "x"), pr(2, "y")];
    expect(visibleRows(prs, null, 1, new Map([[1, [commit("c1"), commit("c2")]]])).map((r) => r.id)).toEqual(["pr:1", "commit:1:c1", "commit:1:c2", "pr:2"]);
    expect(visibleRows(prs, null, 1, new Map()).map((r) => r.kind)).toEqual(["pr", "note", "pr"]);
    expect(visibleRows(prs, null, 2, new Map([[2, []]])).map((r) => r.kind)).toEqual(["pr", "pr", "note"]);
  });
  test("プルリクエストが 0 件なら行も 0 件", () => expect(visibleRows([], "main", null, new Map())).toEqual([]));
});

describe("ws hunk へ渡す引数（GitHub）", () => {
  test("プルリクエスト全体", () => expect(wsHunkPrArgs("/w", 55)).toEqual(["hunk", "/w", "--pr", "55", "--from-app"]));
  test("GitHub のコミット", () => expect(wsHunkGithubCommitArgs("/w", "abc1234")).toEqual(["hunk", "/w", "--gh-commit", "abc1234", "--from-app"]));
  test("コミットが手元にあれば --commit、無ければ --gh-commit", () => {
    expect(wsHunkPrCommitArgs("/w", "abc1234", true)).toEqual(wsHunkArgs("/w", "abc1234", null));
    expect(wsHunkPrCommitArgs("/w", "abc1234", false)).toEqual(["hunk", "/w", "--gh-commit", "abc1234", "--from-app"]);
  });
});
