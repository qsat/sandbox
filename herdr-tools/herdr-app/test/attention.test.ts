import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { agentContext, attentionChanges, attentionMessage, goOnClickCommand, notifyCommands, osascriptArgs, parseTranscriptTail, replyHead, transcriptPath } from "../src/agent-board/attention";
import type { BoardRow } from "../src/agent-board/board";

type AgentRow = Extract<BoardRow, { kind: "agent" }>;
const agentRow = (key: string, rawStatus: string, label = `claude ${key}`): AgentRow => ({ kind: "agent", key, label, rawStatus, worktree: "/g/o/api=feat" }) as AgentRow;
const worktreeRow = { kind: "worktree", key: "/g/o/api" } as BoardRow;
const keys = (rows: AgentRow[]) => rows.map((r) => r.key);

describe("attentionChanges", () => {
  test("最初の 1 回は、blocked や done があっても知らせず、status を覚えるだけ", () => {
    const r = attentionChanges(null, [agentRow("t1", "blocked"), agentRow("t2", "done"), worktreeRow]);
    expect(r.changed).toEqual([]);
    expect([...r.next]).toEqual([
      ["t1", "blocked"],
      ["t2", "done"],
    ]);
  });

  test("blocked か done に変わったエージェントだけを知らせる", () => {
    const prev = new Map([
      ["t1", "working"],
      ["t2", "working"],
      ["t3", "working"],
    ]);
    const r = attentionChanges(prev, [agentRow("t1", "blocked"), agentRow("t2", "done"), agentRow("t3", "idle")]);
    expect(keys(r.changed)).toEqual(["t1", "t2"]);
  });

  test("blocked や done のまま変わらなければ、もう一度は知らせない", () => {
    const prev = new Map([
      ["t1", "blocked"],
      ["t2", "done"],
    ]);
    expect(attentionChanges(prev, [agentRow("t1", "blocked"), agentRow("t2", "done")]).changed).toEqual([]);
  });

  test("blocked から done に変わったら知らせる", () => {
    expect(keys(attentionChanges(new Map([["t1", "blocked"]]), [agentRow("t1", "done")]).changed)).toEqual(["t1"]);
  });

  test("前回いなかったエージェントが blocked で現れたら知らせる", () => {
    expect(keys(attentionChanges(new Map(), [agentRow("t9", "blocked")]).changed)).toEqual(["t9"]);
  });
});

const list = {
  usage: {},
  workspaces: [
    {
      path: "/g/creal/compass-wiki",
      name: "github.com/creal/compass-wiki",
      worktrees: [{ path: "/g/creal/compass-wiki=e2e", branch: "e2e-package", agents: [{ id: "t1g", cwd: "/g/creal/compass-wiki=e2e", claudeSessionId: "s-1" }] }],
    },
  ],
} as unknown as ListedTree;

describe("agentContext", () => {
  test("エージェントのリポジトリ名・ブランチ・cwd・セッション ID を引き当てる", () =>
    expect(agentContext(list, "t1g")).toEqual({ repo: "compass-wiki", branch: "e2e-package", cwd: "/g/creal/compass-wiki=e2e", claudeSessionId: "s-1" }));
  test("見つからなければ null", () => expect(agentContext(list, "t9")).toBeNull());
});

describe("transcriptPath", () => {
  test("cwd の英数字以外を - にしたフォルダーの <セッション ID>.jsonl", () =>
    expect(transcriptPath("/Users/me", "/Users/me/ghq/github.com/creal/compass-wiki=e2e-package", "s-1")).toBe(
      "/Users/me/.claude/projects/-Users-me-ghq-github-com-creal-compass-wiki-e2e-package/s-1.jsonl",
    ));
});

describe("parseTranscriptTail", () => {
  const line = (o: object) => JSON.stringify(o);
  test("最後の依頼と、最後の assistant の text を読む。途中で切れた行や text の無い行は飛ばす", () => {
    const text = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"切れた',
      line({ type: "last-prompt", lastPrompt: "前の依頼" }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "途中の返答" }] } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "最後の返答" }] } }),
      line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "…" }] } }),
      line({ type: "last-prompt", lastPrompt: "落ちた ID の原因を教えて" }),
      line({ type: "system" }),
    ].join("\n");
    expect(parseTranscriptTail(text)).toEqual({ lastPrompt: "落ちた ID の原因を教えて", lastReply: "最後の返答" });
  });
  test("何も無ければ null", () => expect(parseTranscriptTail("")).toEqual({ lastPrompt: null, lastReply: null }));
});

describe("replyHead", () => {
  test("Markdown の記号と空行を外し、最初の 3 行", () =>
    expect(replyHead("## 結論\n\n**17 個**のうち `5 個`が通った。\n\n- 原因は 2 つ\n- 3 つ目\n- 4 つ目")).toBe("結論\n17 個のうち 5 個が通った。\n原因は 2 つ"));
  test("表の区切り線とコードの囲みは飛ばす", () => expect(replyHead("| a | b |\n|---|---|\n```ts\nx")).toBe("| a | b |\nx"));
  test("長ければ 200 文字で切る", () => expect(replyHead("あ".repeat(300))).toHaveLength(200));
});

describe("attentionMessage", () => {
  const ctx = agentContext(list, "t1g");
  test("題名に「リポジトリ (ブランチ) が終わりました」、副題に最後の依頼、本文に返答の冒頭", () =>
    expect(attentionMessage(agentRow("t1g", "done"), ctx, { lastPrompt: "落ちた ID の原因を教えて", lastReply: "17 個のうち 5 個が通った。" })).toEqual({
      title: "compass-wiki (e2e-package) が終わりました",
      subtitle: "落ちた ID の原因を教えて",
      body: "17 個のうち 5 個が通った。",
    }));
  test("blocked なら「待っています」", () => expect(attentionMessage(agentRow("t1g", "blocked"), ctx, { lastPrompt: null, lastReply: null }).title).toBe("compass-wiki (e2e-package) が待っています"));
  test("場所も会話の記録も分からなければ、エージェントの名前で埋める", () =>
    expect(attentionMessage(agentRow("t1g", "done", "t1g x"), null, { lastPrompt: null, lastReply: null })).toEqual({ title: "t1g x が終わりました", subtitle: "t1g x", body: "t1g x" }));
});

describe("osascriptArgs", () => {
  test("題名・副題・本文は argv で渡し、AppleScript の文字列に埋め込まない", () => {
    const args = osascriptArgs({ title: 'a "b"', subtitle: "s", body: "c" });
    expect(args.slice(-4)).toEqual(["--", 'a "b"', "s", "c"]);
  });
});

describe("goOnClickCommand", () => {
  test("ws go <エージェント> --from-app を、ws と tmux が見つかる PATH で実行する", () =>
    expect(goOnClickCommand("t1f", "/Users/me")).toBe("PATH='/Users/me/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' ws go 't1f' --from-app"));
  test("引用符を含む値も 1 語として渡す", () => expect(goOnClickCommand("a'b", "/h")).toContain(`ws go 'a'\\''b' --from-app`));

  test("シェルで実行すると、ws に渡る引数がエージェントのキーそのものになる", () => {
    const cmd = goOnClickCommand("a'b c", "/h").replace(/ ws go /, " printf '%s\\n' go ");
    const r = Bun.spawnSync(["/bin/sh", "-c", cmd]);
    expect(r.stdout.toString()).toBe("go\na'b c\n--from-app\n");
  });
});

describe("notifyCommands", () => {
  const cmds = notifyCommands({ title: "api (main) が待っています", subtitle: "依頼", body: "返答" }, "t1f", "/Users/me");
  test("terminal-notifier をよくある場所から先に試し、最後は osascript", () =>
    expect(cmds.map(([c]) => c)).toEqual(["/opt/homebrew/bin/terminal-notifier", "/usr/local/bin/terminal-notifier", "terminal-notifier", "osascript"]));
  test("terminal-notifier には題名・副題・本文・エージェントごとの group・クリックで移るコマンドを渡す", () =>
    expect(cmds[0]![1]).toEqual(["-title", "api (main) が待っています", "-subtitle", "依頼", "-message", "返答", "-group", "herdr-tools.t1f", "-execute", goOnClickCommand("t1f", "/Users/me")]));
  test("本文が [ で始まるときは \\ を前に付ける", () =>
    expect(notifyCommands({ title: "t", subtitle: "s", body: "[main] 返答" }, "t1f", "/h")[0]![1]).toContain("\\[main] 返答"));
});
