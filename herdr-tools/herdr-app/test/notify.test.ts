import { describe, expect, test } from "bun:test";
import type { ListedTree } from "@herdr-tools/tmux/list-json";
import { attentionChanges } from "../src/agent-board/notify/attention";
import { goOnClickCommand, notifyCommands, osascriptArgs } from "../src/agent-board/notify/commands";
import { agentContext, attentionMessage, replyHead } from "../src/agent-board/notify/message";
import { NOTIFY_LOG, notifyAgent, postNotification, type NotifyIo } from "../src/agent-board/notify/notifier";
import { parseTranscriptTail, transcriptPath } from "../src/agent-board/notify/transcript";
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
    expect(goOnClickCommand("t1f", "/Users/me")).toBe("PATH=/Users/me/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin ws go t1f --from-app"));
  test("引用符を含む値も 1 語として渡す", () => expect(goOnClickCommand("a'b", "/h")).toContain(`ws go 'a'\\''b' --from-app`));
  test("ホームに空白があっても PATH は 1 語になる", () => expect(goOnClickCommand("t1f", "/Users/my me")).toStartWith("PATH='/Users/my me/.local/bin:"));

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

/** 偽の I/O。exec はコマンドごとに決めた結果を返し（"reject" なら起動できない）、呼ばれた順と書いたファイルを残す */
function fakeIo(results: Record<string, { code: number; stdout?: string; stderr?: string } | "reject">) {
  const calls: { command: string; args: string[] }[] = [];
  const files: Record<string, string> = {};
  const io: NotifyIo = {
    home: "/Users/me",
    async exec(command, args) {
      calls.push({ command, args });
      const r = results[command];
      if (r === undefined || r === "reject") throw new Error(`${command}: not found`);
      return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    async readTextFile(path) {
      return files[path] ?? null;
    },
    async writeTextFile(path, text) {
      files[path] = text;
      return null;
    },
  };
  return { io, calls, files };
}

describe("postNotification", () => {
  const commands: [string, string[]][] = [
    ["/opt/homebrew/bin/terminal-notifier", ["-title", "t"]],
    ["terminal-notifier", ["-title", "t"]],
    ["osascript", ["-e", "x"]],
  ];
  const now = new Date("2026-11-06T09:00:00Z");

  test("最初のコマンドが終了コード 0 なら、そこで止める", async () => {
    const { io, calls } = fakeIo({ "/opt/homebrew/bin/terminal-notifier": { code: 0 } });
    expect(await postNotification(commands, io, now)).toEqual(["/opt/homebrew/bin/terminal-notifier: exit 0"]);
    expect(calls.map((c) => c.command)).toEqual(["/opt/homebrew/bin/terminal-notifier"]);
  });

  test("通知の許可が無く 0 以外で終わったら、次のコマンドを試す", async () => {
    const { io, calls } = fakeIo({ "/opt/homebrew/bin/terminal-notifier": { code: 3, stderr: "not allowed" }, "terminal-notifier": { code: 3 }, osascript: { code: 0 } });
    await postNotification(commands, io, now);
    expect(calls.map((c) => c.command)).toEqual(["/opt/homebrew/bin/terminal-notifier", "terminal-notifier", "osascript"]);
  });

  test("起動できないコマンドは飛ばし、試した結果をログに残す", async () => {
    const { io, files } = fakeIo({ "/opt/homebrew/bin/terminal-notifier": "reject", "terminal-notifier": "reject", osascript: { code: 0 } });
    await postNotification(commands, io, now);
    expect(files[`/Users/me/${NOTIFY_LOG}`]).toBe(
      "2026-11-06T09:00:00.000Z\n/opt/homebrew/bin/terminal-notifier: 起動できない /opt/homebrew/bin/terminal-notifier: not found\nterminal-notifier: 起動できない terminal-notifier: not found\nosascript: exit 0\n",
    );
  });
});

describe("notifyAgent", () => {
  test("会話の記録の末尾を tail で読み、依頼と返答を書いた通知を terminal-notifier で出す", async () => {
    const transcript = [JSON.stringify({ type: "last-prompt", lastPrompt: "落ちた ID の原因を教えて" }), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "5 個が通った。" }] } })].join("\n");
    const { io, calls } = fakeIo({ tail: { code: 0, stdout: transcript }, "/opt/homebrew/bin/terminal-notifier": { code: 0 } });
    await notifyAgent(agentRow("t1g", "done"), list, io);
    expect(calls[0]).toEqual({ command: "tail", args: ["-n", "300", transcriptPath("/Users/me", "/g/creal/compass-wiki=e2e", "s-1")] });
    expect(calls[1]!.args.slice(0, 6)).toEqual(["-title", "compass-wiki (e2e-package) が終わりました", "-subtitle", "落ちた ID の原因を教えて", "-message", "5 個が通った。"]);
  });

  test("会話の記録が読めなければ、エージェントの名前で埋めて出す", async () => {
    const { io, calls } = fakeIo({ tail: "reject", "/opt/homebrew/bin/terminal-notifier": { code: 0 } });
    await notifyAgent(agentRow("t1g", "done", "t1g x"), list, io);
    expect(calls[1]!.args.slice(2, 6)).toEqual(["-subtitle", "t1g x", "-message", "t1g x"]);
  });
});
