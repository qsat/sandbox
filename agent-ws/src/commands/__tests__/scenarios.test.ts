/**
 * シナリオテスト: 本物の Claude Code（2.1.309）から録った hook の入力を、1件ずつ「hook の1回の起動」として流し、
 * 各コマンド（status・list・seen・jump・watch）が人に見せる結果を確かめる。
 * 外界（tmux・ps・git・通知）は偽物に差し替える。ログは一時ディレクトリに書く
 */
import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pane } from "../../redux/types/visit.ts";

// ---------------------------------------------------------------------
// 偽の外界
// ---------------------------------------------------------------------
const AGENT_PID = process.ppid; // hook は親プロセスを辿って claude 本体を探すので、テストの親を claude とみなす
const PANE_PID = 990_001; // claude が動いているペインのシェル
const OTHER_PANE_PID = 990_002;
const REPO = "/g/github.com/acme/api";
const FEATURE = "/g/github.com/acme/api-feat";

const pane = (id: string, pid: number, path: string): Pane => ({
  id,
  pid,
  session: "main",
  window: id.slice(1),
  windowName: "w",
  path,
  active: false,
});

const world = {
  procs: [{ pid: AGENT_PID, ppid: PANE_PID, command: "claude", cwd: FEATURE }],
  panes: [pane("%0", OTHER_PANE_PID, "/tmp"), pane("%1", PANE_PID, FEATURE)],
  dirty: {} as Record<string, number>,
  refreshes: 0,
  notices: [] as string[],
};
/** 人がいま見ているペイン */
const look = (id: string) => {
  world.panes = world.panes.map((p) => ({ ...p, active: p.id === id }));
};

const worktree = (path: string, branch: string, isMain: boolean) => ({
  path,
  branch,
  head: "0123abcd",
  isMain,
  bare: false,
  locked: false,
  prunable: false,
  dirty: null,
  agents: [],
});

mock.module("../../redux/middlewares/processes/proc.ts", () => ({
  psTable: () => world.procs.map((p) => ({ pid: p.pid, ppid: p.ppid, elapsed: "00:01", command: p.command })),
  listProcesses: () => world.procs.map((p) => ({ ...p, elapsed: "00:01" })),
  isAlive: (pid: number) => world.procs.some((x) => x.pid === pid),
}));
mock.module("../../redux/middlewares/tmux/tmux.ts", () => ({
  listPanes: () => world.panes,
  focusPane: (id: string) => {
    look(id);
    return true;
  },
  newWindow: () => null,
}));
mock.module("../../ui/subscribers/tmux.ts", () => ({
  refreshStatus: () => {
    world.refreshes++;
  },
  displayMessage: () => null,
}));
mock.module("../../redux/middlewares/git/git.ts", () => ({
  ghqRoots: () => ["/g"],
  listRepoPaths: () => [REPO],
  listWorktrees: () => [worktree(REPO, "main", true), worktree(FEATURE, "feat", false)],
  countDirty: (path: string) => world.dirty[path] ?? 0,
  currentBranch: () => "feat",
  locate: () => ({ repo: "github.com/acme/api", branch: "feat" }),
}));
mock.module("../../ui/subscribers/notify.ts", () => ({
  notify: (title: string, body: string) => world.notices.push(`${title} ${body}`),
}));

// 差し替えた外部システムを使わせるため、コマンドは差し替えた後に読み込む
const { hook } = await import("../hook.ts");
const { status: statusStore } = await import("../status.ts");
const { list: listStore } = await import("../list.ts");
const { seen } = await import("../seen.ts");
const { jump } = await import("../jump.ts");
const { watch } = await import("../watch.ts");
const { parseCommand } = await import("../../entry/utils/command.ts");
const { contextOf } = await import("../../entry/utils/context.ts");
const { statusText } = await import("../../ui/status.ts");
const { listText } = await import("../../ui/list.ts");
const { jumpText } = await import("../../ui/jump.ts");
const { selectArrived } = await import("../../redux/modules/ui/visit/selector.ts");
const { selectShouldClose, selectShownVisit } = await import("../../redux/modules/ui/watch/selector.ts");
const { selectUnseen } = await import("../../redux/modules/app/attention/selector.ts");
const { destinationChosen } = await import("../../redux/modules/ui/visit/slice.ts");
const { rowSelected } = await import("../../redux/modules/ui/watch/slice.ts");

// ---------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------
const FIXTURES = new URL("../../redux/middlewares/claude/__tests__/fixtures/", import.meta.url);
const read = async (name: string) => (await Bun.file(new URL(name, FIXTURES)).text()).trim().split("\n");
const filter = { all: false, agentsOnly: false };

/** 環境変数はログの置き場所だけ（通知はすべての種類）。いまの時刻はコマンドを動かすたびに取る */
const dir = mkdtempSync(join(tmpdir(), "agent-ws-scenario-"));
const ctx = () => contextOf({ AGENT_WS_STATE_DIR: dir }, Date.now(), { pid: process.pid, ppid: AGENT_PID, platform: "linux" }, "/home/u");

const status = () => statusText(statusStore(ctx()).getState(), "none");
const list = () =>
  listText(
    listStore({ kind: "list", filter, json: false }, ctx()).getState(),
    { filter, json: false },
    { color: "none", width: 200, home: "/home/u" },
  );
const runSeen = (panePid: number) => seen({ kind: "seen", panePid }, ctx());
const receiveHook = (input: unknown) => hook(input, ctx());
/** jump のコマンドラインを解釈して動かし、出力と、行き先に着いたかを返す */
function runJump(argv: string[]) {
  const c = parseCommand(["jump", ...argv], FEATURE);
  if (c.kind !== "jump") throw new Error(`jump として解釈されない: ${c.kind}`);
  const st = jump(c, ctx()).getState();
  return { text: jumpText(st, c.target, "none"), ok: selectArrived(st) };
}
/** エージェント（claude）の行 */
const agentLine = () =>
  list()
    .split("\n")
    .find((l) => l.includes("[claude]")) ?? "";

/** 録った hook の入力を流す。会話ログの置き場所と worktree を、このテストのものに差し替える */
function hooks(inputs: string[], agentId: string, transcript: string) {
  for (const line of inputs) {
    receiveHook({ ...JSON.parse(line), session_id: agentId, cwd: FEATURE, transcript_path: transcript });
  }
}

/** 条件が成り立つまで待つ（ファイルの見張りなど、非同期に届くもの） */
async function until(ok: () => boolean, deadline = Date.now() + 2000): Promise<void> {
  if (ok() || Date.now() > deadline) return void expect(ok()).toBe(true);
  await Bun.sleep(10);
  return until(ok, deadline);
}

/** ステータスライン・通知は出来事の連鎖が終わってから出すので、それを待つ */
const settle = () => Bun.sleep(1);

/**
 * 録った会話ログを、直前の hook より後に書かれたものとして置く（Esc・拒否は hook が発火せず、会話ログにだけ残る）。
 * ファイルの時刻は数 ms 単位と粗いので、書いた時刻は明示する
 */
async function writeTranscript(path: string, fixture: string) {
  const at = new Date(Date.now() + 1);
  const lines = (await read(fixture)).map((l) => JSON.stringify({ ...JSON.parse(l), timestamp: at.toISOString() }));
  writeFileSync(path, `${lines.join("\n")}\n`);
  utimesSync(path, at, at);
}

// ---------------------------------------------------------------------
// シナリオ（上から順に、1つのセッションを進める）
// ---------------------------------------------------------------------
describe("1つのセッションの流れ", async () => {
  const turns = await read("claude-code-2.1.309-turns.jsonl");
  const transcript = join(dir, "s1.transcript.jsonl");
  writeFileSync(transcript, "");
  const feed = (from: number, to: number) => hooks(turns.slice(from, to + 1), "s1", transcript);
  const events = turns.map((l) => JSON.parse(l).hook_event_name as string);

  test("録った入力の並び", () => {
    expect(events).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "UserPromptSubmit",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
      "PermissionRequest",
      "UserPromptSubmit",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
      "SubagentStop",
      "UserPromptSubmit",
      "SessionEnd",
    ]);
  });

  test("起動すると入力待ち。本体の pid がわかり、そのペインへ行ける", () => {
    look("%0");
    feed(0, 0);
    expect(status()).toBe("");
    expect(agentLine()).toContain("✓ 入力待ち");
    expect(agentLine()).toContain(`pid ${AGENT_PID}`);
    expect(runJump([String(AGENT_PID), "--dry-run"])).toEqual({ ok: true, text: "main:1 (w) %1" });
  });

  test("別のペインを見ている間に完了すると ✓ と通知。そのペインにフォーカスすると確認済みになる", async () => {
    const before = world.notices.length;
    feed(1, 2);
    await settle();
    expect(status()).toBe("✓");
    expect(agentLine()).toContain("✓ 完了");
    expect(world.notices.slice(before)).toEqual(["api [feat] ✓ 完了: 2"]);
    runSeen(PANE_PID);
    expect(status()).toBe("");
    expect(agentLine()).toContain("✓ 入力待ち");
  });

  test("許可待ちは ⏳ と内容を出して知らせる。許可されれば実行中に戻る", async () => {
    const before = world.notices.length;
    feed(3, 4);
    await settle();
    expect(status()).toBe("⏳");
    expect(agentLine()).toContain("⏳ 許可待ち");
    expect(agentLine()).toContain("Bash: echo a > approve.txt");
    expect(world.notices.slice(before)).toEqual(["api [feat] ⏳ 許可待ち: Bash: echo a > approve.txt"]);
    feed(5, 5);
    expect(agentLine()).toContain("● 実行中");
  });

  test("いま見ているペインで完了したら ✓ を出さない（ステータスラインも描き直さず、知らせもしない。内部用のエージェントは数えない）", async () => {
    look("%1");
    await settle(); // それまでの描き直し・通知を済ませてから数える
    const refreshes = world.refreshes;
    const notices = world.notices.length;
    feed(6, 7);
    await settle();
    expect(world.refreshes).toBe(refreshes); // 完了して確認済みになる間の ✓ は映さない
    expect(world.notices.length).toBe(notices); // 見ているので知らせない
    expect(status()).toBe("");
    expect(agentLine()).toContain("✓ 入力待ち");
    expect(list()).not.toContain("⤷");
    look("%0");
  });

  test("許可を拒否すると hook は来ないが、会話ログから中断を拾って入力待ちに戻す", async () => {
    feed(8, 9);
    expect(status()).toBe("⏳");
    await writeTranscript(transcript, "transcript-deny.jsonl");
    expect(status()).toBe("");
    expect(agentLine()).toContain("中断しました");
  });

  test("質問は ❓。答えて完了すれば ✓", () => {
    feed(10, 11);
    expect(status()).toBe("❓");
    expect(agentLine()).toContain("❓ 質問待ち");
    feed(12, 14);
    expect(status()).toBe("✓");
    runSeen(PANE_PID);
  });

  test("応答中の Esc も、会話ログから中断を拾う", async () => {
    feed(15, 15);
    expect(agentLine()).toContain("● 実行中");
    await writeTranscript(transcript, "transcript-esc.jsonl");
    expect(status()).toBe("");
    expect(agentLine()).toContain("中断しました");
  });

  test("ステータスラインは印が変わったときだけ描き直す", async () => {
    await settle();
    expect(world.refreshes).toBeGreaterThan(0);
    const before = world.refreshes;
    feed(15, 15); // 実行中になる（印は変わらない）
    await settle();
    expect(world.refreshes).toBe(before);
  });

  test("セッションが終わるとログが消え、一覧から消える", () => {
    feed(16, 16);
    expect(readdirSync(dir).filter((f) => f.startsWith("s1."))).toEqual(["s1.transcript.jsonl"]);
    expect(status()).toBe("");
  });
});

describe("実データ: バックグラウンドのサブエージェント", async () => {
  const inputs = await read("claude-code-2.1.309.jsonl");
  const events = inputs.map((l) => JSON.parse(l).hook_event_name as string);
  const upTo = (event: string, nth = 0) =>
    events.findIndex((e, i) => e === event && events.slice(0, i).filter((x) => x === event).length === nth);

  test("サブエージェントが許可を待つと本体も ⏳。許可されて本体が完了すれば ✓", () => {
    look("%0");
    hooks(inputs.slice(0, upTo("PermissionRequest") + 1), "s2", "");
    expect(status()).toBe("⏳");
    expect(list()).toContain("⤷ general-purpose  ⏳ 許可待ち");
    hooks(inputs.slice(upTo("PermissionRequest") + 1, upTo("Stop", 1) + 1), "s2", "");
    expect(status()).toBe("✓");
    expect(list()).toContain("⤷ general-purpose  ✓ 完了");
    hooks(inputs.slice(upTo("Stop", 1) + 1), "s2", "");
  });
});

describe("プロセスと worktree", () => {
  test("SessionEnd が来なくても、プロセスが消えたら閉じる", () => {
    receiveHook({ hook_event_name: "SessionStart", session_id: "s3", cwd: FEATURE });
    expect(readdirSync(dir)).toContain("s3.jsonl");
    const saved = world.procs;
    world.procs = [];
    expect(status()).toBe("");
    expect(readdirSync(dir)).not.toContain("s3.jsonl");
    world.procs = saved;
  });

  test("変更件数はエージェントのいる worktree も数える", () => {
    world.dirty[FEATURE] = 3;
    receiveHook({ hook_event_name: "SessionStart", session_id: "s4", cwd: FEATURE });
    expect(list()).toContain("feat  0123abcd  dirty:3");
    receiveHook({ hook_event_name: "SessionEnd", session_id: "s4", cwd: FEATURE });
  });
});

describe("watch の画面", () => {
  test("popup で行き先へ移れたら閉じ、その完了は確認済みになる。行を選ぶと移動の結果は消える", () => {
    look("%0");
    receiveHook({ hook_event_name: "SessionStart", session_id: "s5", cwd: FEATURE });
    receiveHook({ hook_event_name: "UserPromptSubmit", session_id: "s5", cwd: FEATURE });
    receiveHook({ hook_event_name: "Stop", session_id: "s5", cwd: FEATURE, last_assistant_message: "終わり" });
    const store = watch({ kind: "watch", filter, intervalMs: 3_600_000, popup: true }, ctx());
    expect(selectUnseen(store.getState(), "s5")).toBe(true);
    store.dispatch(destinationChosen({ target: { title: "x", name: "x", pid: AGENT_PID }, create: false }));
    expect(world.panes.find((p) => p.active)?.id).toBe("%1");
    expect(selectShouldClose(store.getState())).toBe(true);
    expect(selectUnseen(store.getState(), "s5")).toBe(false);
    store.dispatch(rowSelected("pid:1"));
    expect(selectShownVisit(store.getState())).toBeNull();
    receiveHook({ hook_event_name: "SessionEnd", session_id: "s5", cwd: FEATURE });
  });

  test("実行中のエージェントの会話ログを見張り、Esc の中断を interval を待たずに拾う", async () => {
    const transcript = join(dir, "s6.transcript.jsonl");
    writeFileSync(transcript, "");
    const on = { session_id: "s6", cwd: FEATURE, transcript_path: transcript };
    receiveHook({ ...on, hook_event_name: "SessionStart" });
    receiveHook({ ...on, hook_event_name: "UserPromptSubmit" });
    const store = watch({ kind: "watch", filter, intervalMs: 3_600_000, popup: false }, ctx()); // 時間が経ったことにはならない
    const turn = () => store.getState().app.agents.byId.s6?.turn;
    expect(turn()?.status).toBe("running");
    await writeTranscript(transcript, "transcript-esc.jsonl");
    await until(() => turn()?.status === "ready");
    expect(turn()?.reason).toBe("中断しました");
    receiveHook({ ...on, hook_event_name: "SessionEnd" });
  });
});
