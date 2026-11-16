import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ClaudeSessionTitles, WsCore, type AgentRecord, type AgentRuntime, type WorkspaceSource } from "../src";
import { sessionTitleFromTranscript, claudeTranscriptPath } from "../src/claude-code";

const title = (t: string) => JSON.stringify({ type: "ai-title", aiTitle: t, sessionId: "s1" });
const reply = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

describe("sessionTitleFromTranscript", () => {
  test("最後の ai-title の行のタイトルを読む", () => {
    expect(sessionTitleFromTranscript([title("古い題"), reply("a"), title("新しい題"), reply("b")].join("\n"))).toBe("新しい題");
  });
  test("ai-title の行が無ければ undefined", () => {
    expect(sessionTitleFromTranscript([reply("a"), ""].join("\n"))).toBeUndefined();
    expect(sessionTitleFromTranscript("")).toBeUndefined();
  });
  test("途中で切れた行・返答の文中の文字列は飛ばして、前の ai-title の行を読む", () => {
    const cut = title("切れた題").slice(8);
    expect(sessionTitleFromTranscript([title("前の題"), reply('"type":"ai-title" と書いた返答'), cut].join("\n"))).toBe("前の題");
    expect(sessionTitleFromTranscript(cut)).toBeUndefined();
  });
  test("/rename で付けた名前（custom-title の行）があれば、ai-title より優先する", () => {
    const renamed = (t: string) => JSON.stringify({ type: "custom-title", customTitle: t, sessionId: "s1" });
    // /rename の直後: ai-title の後に custom-title が 1 行ある
    expect(sessionTitleFromTranscript([title("自動の題"), renamed("付けた名前")].join("\n"))).toBe("付けた名前");
    // その後に ai-title の行が続いても、付けた名前を出す
    expect(sessionTitleFromTranscript([renamed("付けた名前"), title("自動の題")].join("\n"))).toBe("付けた名前");
    // 名前を付け直したら、最後の名前を出す
    expect(sessionTitleFromTranscript([renamed("前の名前"), renamed("新しい名前")].join("\n"))).toBe("新しい名前");
  });
  test("空のタイトルは無いものとして扱う", () => {
    expect(sessionTitleFromTranscript([title("前の題"), title("  ")].join("\n"))).toBe("前の題");
  });
});

describe("ClaudeSessionTitles", () => {
  const home = mkdtempSync(join(tmpdir(), "ws-titles-"));
  const write = (cwd: string, sessionId: string, text: string) => {
    const path = claudeTranscriptPath(home, cwd, sessionId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const titles = new ClaudeSessionTitles(home);

  test("記録のパスは cwd の英数字以外を - に置き換える", () => {
    expect(claudeTranscriptPath("/h", "/g/o/api=feat.x", "s1")).toBe("/h/.claude/projects/-g-o-api-feat-x/s1.jsonl");
  });
  test("記録の末尾からタイトルを読む", async () => {
    write("/g/o/api", "s1", [title("古い題"), title("新しい題"), reply("b"), ""].join("\n"));
    expect(await titles.titleOf("/g/o/api", "s1")).toBe("新しい題");
  });
  test("タイトルの後に長い出力が続いて末尾の 64KB に無くても、前のタイトルを読む", async () => {
    write("/g/o/api", "s2", [title("長い依頼の題"), reply("x".repeat(200 * 1024)), ""].join("\n"));
    expect(await titles.titleOf("/g/o/api", "s2")).toBe("長い依頼の題");
  });
  test("記録が無い・タイトルがまだ無いときは undefined", async () => {
    write("/g/o/api", "s3", reply("a") + "\n");
    expect(await titles.titleOf("/g/o/api", "s3")).toBeUndefined();
    expect(await titles.titleOf("/g/o/api", "none")).toBeUndefined();
  });
});

describe("WsCore.snapshot のタイトル", () => {
  const agent = (id: string, claudeSessionId?: string): AgentRecord => ({ id, name: id, cwd: "/g/o/api", status: "idle", alive: true, parent: null, claudeSessionId });
  const runtime = { list: async () => [agent("t1", "s1"), agent("t2", "s2"), agent("t3")] } as unknown as AgentRuntime;
  const source: WorkspaceSource = {
    root: async () => "/g",
    entries: async () => [],
    inspect: async (paths) => paths.map((path) => ({ path, exists: true, toplevel: "/g/o/api", commonDir: "/g/o/api/.git", branch: "main" })),
    worktrees: async () => ["/g/o/api"],
  };
  const agentsOf = async (core: WsCore) => (await core.snapshot()).tree.workspaces.flatMap((ws) => ws.worktrees.flatMap((wt) => wt.agents)).map((a) => [a.id, a.title]);

  test("会話 ID があってタイトルが読めたエージェントにだけ title が付く", async () => {
    const asked: string[] = [];
    const sessionTitles = {
      titleOf: async (cwd: string, sid: string) => {
        asked.push(`${cwd} ${sid}`);
        if (sid === "s2") throw new Error("読めない");
        return "題 " + sid;
      },
    };
    expect(await agentsOf(new WsCore(runtime, source, { sessionTitles }))).toEqual([
      ["t1", "題 s1"],
      ["t2", undefined],
      ["t3", undefined],
    ]);
    expect(asked.sort()).toEqual(["/g/o/api s1", "/g/o/api s2"]);
  });
  test("sessionTitles を渡さなければ title は付かない", async () => {
    expect(await agentsOf(new WsCore(runtime, source))).toEqual([
      ["t1", undefined],
      ["t2", undefined],
      ["t3", undefined],
    ]);
  });
});
