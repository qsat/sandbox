import { expect, test } from "bun:test";
import { parseLsofCwds, parsePsTable } from "../parse.ts";

test("ps の一覧: 右寄せの pid・経過時間・空白を含むコマンド。解釈できない行は飛ばす", () => {
  const out = `    1     0       01:58 /sbin/init splash
  104     1  1-02:03:04 bun /home/u/.bun/bin/claude --resume
garbage
`;
  expect(parsePsTable(out)).toEqual([
    { pid: 1, ppid: 0, elapsed: "01:58", command: "/sbin/init splash" },
    { pid: 104, ppid: 1, elapsed: "1-02:03:04", command: "bun /home/u/.bun/bin/claude --resume" },
  ]);
});

test("lsof -Fpn: p と n の組。間に f などの行が入っても拾う", () => {
  const out = "p123\nfcwd\nn/Users/u/api\np456\nn/Users/u/api feat\n";
  expect(parseLsofCwds(out)).toEqual(
    new Map([
      [123, "/Users/u/api"],
      [456, "/Users/u/api feat"],
    ]),
  );
});
