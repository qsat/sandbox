/**
 * 端末込みの E2E: 専用の tmux サーバにクライアントを接続し、その中で偽の claude を動かして、
 * ステータスライン・pane-focus-in・ポップアップ・jump・通知・常駐表示まで通して確かめる
 *
 * tmux・ps・git は本物を使う。Claude Code の代わりに、記録した hook 入力を hooks 設定（hooks-config の出力）どおりに流す
 * 偽の claude（fake-claude.ts）を使う。tmux の設定は HANDOFF.md のセットアップと同じにする。
 * 重いので既定では動かさない: `bun run e2e`（AGENT_WS_E2E=1）。tmux・script・git が無ければ飛ばす
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { attempt } from "../../../lib/attempt.ts";

const TOOLS = ["tmux", "script", "git", "ps", "sh"];
const enabled = process.env.AGENT_WS_E2E === "1" && TOOLS.every((t) => Bun.which(t));

const PROJECT = join(import.meta.dir, "../../../..");
const CLI = join(PROJECT, "src/entry/cli.ts");
const INPUTS = join(PROJECT, "src/redux/listeners/claude/__tests__/fixtures/claude-code-2.1.309-turns.jsonl");
const TIMEOUT = 20_000;

/** 作業ディレクトリ（動かすときだけ beforeAll で作る） */
const root = join(realpathSync(tmpdir()), `agent-ws-e2e-${process.pid}`);
const path = (...p: string[]) => join(root, ...p);
const repo = () => path("ghq/github.com/acme/api");
const feature = () => path("ghq/github.com/acme/api-feat");
const screenLog = path("screen.log"); // 接続したクライアントの端末に出た文字（エスケープシーケンスを含む）

/** 人の端末の代わりに接続したクライアント。ポップアップへのキーはここから打つ（tmux の send-keys -K はポップアップに届かない） */
// biome-ignore lint/plugin/no-let: beforeAll で接続し、テストからキーを打つ
let client: Subprocess<"pipe", "ignore", "ignore"> | undefined;
const type = (keys: string) => {
  client?.stdin.write(keys);
  client?.stdin.flush();
};

const utf8Lang = () => {
  if (process.env.LANG?.includes("UTF-8")) return process.env.LANG;
  return "C.UTF-8";
};

const env: Record<string, string> = {
  PATH: [...new Set([path("bin"), dirname(process.execPath), ...TOOLS.map((t) => dirname(Bun.which(t) ?? "/usr/bin"))])].join(":"),
  HOME: path("home"),
  LANG: utf8Lang(),
  TERM: "xterm-256color",
  TMUX_TMPDIR: root,
  GHQ_ROOT: path("ghq"),
  AGENT_WS_STATE_DIR: path("state"),
  CLAUDE_CONFIG_DIR: path("claude"),
  FAKE_CLAUDE_INPUTS: INPUTS,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "e2e",
  GIT_AUTHOR_EMAIL: "e2e@example.com",
  GIT_COMMITTER_NAME: "e2e",
  GIT_COMMITTER_EMAIL: "e2e@example.com",
};

function sh(cmd: string[], cwd = root): string {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (!r.success) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}
const tmux = (...args: string[]) => sh([Bun.which("tmux") ?? "tmux", ...args]).trim();
const agentWs = (...args: string[]) => sh([path("bin/agent-ws"), ...args]);
const status = () => agentWs("status").trim();
const list = () => agentWs("list");
const notices = () => attempt(() => readFileSync(path("notices"), "utf8"), "");
const screen = () => attempt(() => readFileSync(screenLog, "utf8"), "");
const clientName = () => tmux("list-clients", "-F", "#{client_name}");
const activeWindow = () => tmux("display-message", "-p", "-t", "main", "#{window_index}");
const capture = (target: string) => tmux("capture-pane", "-p", "-t", target);

/** 条件が成り立つまで待つ。成り立たなければ最後に見た値を添えて失敗する */
const until = <T>(what: string, read: () => T, ok: (v: T) => boolean, ms = 8000): Promise<T> => poll(what, read, ok, Date.now() + ms);

async function poll<T>(what: string, read: () => T, ok: (v: T) => boolean, deadline: number): Promise<T> {
  const v = read();
  if (ok(v)) return v;
  if (Date.now() > deadline) throw new Error(`${what} にならない（最後の値: ${JSON.stringify(v)}）`);
  await Bun.sleep(50);
  return poll(what, read, ok, deadline);
}

/** 偽の claude に1行送り、流し終えるまで待つ */
const sent = new Map<string, number>();
async function feed(target: string, line: string): Promise<void> {
  const n = (sent.get(target) ?? 0) + 1;
  sent.set(target, n);
  tmux("send-keys", "-t", target, line, "Enter");
  await until(
    `${target} が「${line}」を流し終える`,
    () => capture(target),
    (s) => s.includes(`[ok ${n}]`),
  );
}

const CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g"); // 端末の制御シーケンス（色・カーソル移動）

/** ステータスラインに出ている印（status-right を "SR[…]" で囲んで、クライアントの端末に最後に描かれた中身を読む） */
function statusLine(): string {
  const plain = screen().replace(CSI, "");
  const i = plain.lastIndexOf("SR[");
  if (i < 0) return "(未描画)";
  return plain.slice(i + 3, plain.indexOf("]", i));
}

/** エージェントのプロセス（list --json から） */
function agentPids(): { pid: number; cwd: string }[] {
  const repos = JSON.parse(agentWs("list", "--json")) as { worktrees: { agents: { process: { pid: number; cwd: string } }[] }[] }[];
  return repos.flatMap((r) => r.worktrees.flatMap((w) => w.agents.map(({ process: { pid, cwd } }) => ({ pid, cwd }))));
}

const script = (file: string, body: string) => {
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};

/** 人の端末の代わりに script でクライアントを接続する（端末に出た文字は screenLog に残る） */
function attachCommand(): string[] {
  const attach = "stty cols 160 rows 40; exec tmux -u attach -t main";
  if (process.platform === "darwin") return ["script", "-qF", screenLog, "sh", "-c", attach];
  return ["script", "-qfc", attach, screenLog];
}

beforeAll(async () => {
  if (!enabled) return;
  for (const d of ["bin", "home", "state", "claude", "ghq/github.com/acme"]) mkdirSync(path(d), { recursive: true });

  // コマンド: agent-ws（このリポジトリのソース）・偽の claude・通知の記録・ghq は無いことにする（GHQ_ROOT を見る）
  script(path("bin/agent-ws"), `exec "${process.execPath}" "${CLI}" "$@"`);
  symlinkSync(join(import.meta.dir, "fake-claude.ts"), path("bin/claude"));
  for (const n of ["notify-send", "osascript"]) script(path("bin", n), `printf '%s\\n' "$*" >> "${path("notices")}"`);
  script(path("bin/ghq"), "exit 1");
  writeFileSync(path("claude/settings.json"), agentWs("hooks-config"));

  // リポジトリ: main と、フラットに展開した feat の worktree（変更が1件）
  mkdirSync(repo());
  sh(["git", "init", "-q", "-b", "main"], repo());
  writeFileSync(join(repo(), "README.md"), "e2e\n");
  sh(["git", "add", "."], repo());
  sh(["git", "commit", "-q", "-m", "init"], repo());
  sh(["git", "worktree", "add", "-q", "-b", "feat", feature()], repo());
  writeFileSync(join(feature(), "wip.txt"), "wip\n");

  // tmux: HANDOFF.md のセットアップと同じ設定（status-interval は長くして、描き直しが agent-ws から来ることを確かめる）
  tmux("-f", "/dev/null", "new-session", "-d", "-s", "main", "-x", "160", "-y", "40", "-n", "home", "-c", root);
  tmux("set", "-g", "default-command", "exec /bin/sh"); // ログインシェルにしない（/etc/profile が PATH を上書きする）
  tmux("set", "-g", "status-interval", "600");
  tmux("set", "-g", "status-right", "SR[#(agent-ws status --tmux)]");
  tmux("set", "-g", "focus-events", "on");
  tmux("set-hook", "-g", "pane-focus-in", 'run-shell -b "agent-ws seen #{pane_pid}"');
  tmux("new-window", "-d", "-t", "main:1", "-n", "feat", "-c", feature());
  tmux("new-window", "-d", "-t", "main:2", "-n", "watch", "-c", root, "agent-ws watch --interval=60");

  // tmux サーバを止めればクライアントも script も終わる
  client = Bun.spawn(attachCommand(), { cwd: root, env, stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  await until("クライアントが接続する", clientName, (s) => s.length > 0);
}, TIMEOUT);

afterAll(async () => {
  if (!enabled) return;
  if (process.env.AGENT_WS_E2E_KEEP) return console.log(`残した（tmux も動いたまま）: TMUX_TMPDIR=${root}`);
  Bun.spawnSync([Bun.which("tmux") ?? "tmux", "kill-server"], { env });
  await Promise.race([client?.exited, Bun.sleep(2000)]);
  client?.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!enabled)("tmux の中で使う", () => {
  test(
    "claude を起動すると、そのリポジトリ・worktree の下に入力待ちで出る",
    async () => {
      tmux("send-keys", "-t", "main:1", "claude", "Enter");
      const text = await until("一覧に入力待ちが出る", list, (s) => s.includes("入力待ち"));
      expect(text).toContain("api");
      expect(text).toContain("feat");
      expect(agentPids()).toEqual([{ pid: expect.any(Number), cwd: feature() }]);
      expect(status()).toBe("");
      await until(
        "常駐表示に出る",
        () => capture("main:2"),
        (s) => s.includes("入力待ち"),
      );
    },
    TIMEOUT,
  );

  test(
    "別のウィンドウを見ている間に完了すると、ステータスラインに ✓ が出て通知される。常駐表示にもすぐ出る",
    async () => {
      expect(activeWindow()).toBe("0");
      await feed("main:1", "1 2");
      expect(status()).toBe("✓");
      expect(notices()).toContain("api [feat] ✓ 完了: 2");
      await until("ステータスラインに ✓", statusLine, (s) => s === "✓");
      await until(
        "常駐表示に完了",
        () => capture("main:2"),
        (s) => s.includes("✓ 完了"),
      );
    },
    TIMEOUT,
  );

  test(
    "そのウィンドウへ移ると pane-focus-in で確認済みになり、ステータスラインから消える",
    async () => {
      tmux("select-window", "-t", "main:1");
      await until("確認済みになる", status, (s) => s === "");
      await until("ステータスラインが空になる", statusLine, (s) => s === "");
    },
    TIMEOUT,
  );

  test(
    "見ているペインで許可を求めると ⏳。許可されて完了しても ✓ は出ない",
    async () => {
      await feed("main:1", "3 4");
      expect(status()).toBe("⏳");
      expect(notices()).toContain("⏳ 許可待ち: Bash: echo a > approve.txt");
      await until("ステータスラインに ⏳", statusLine, (s) => s === "⏳");
      await feed("main:1", "5 6 7");
      expect(status()).toBe("");
      await until("ステータスラインが空になる", statusLine, (s) => s === "");
    },
    TIMEOUT,
  );

  test(
    "ポップアップで Enter を押すと、待っているエージェントのペインへ移り、ポップアップが閉じる",
    async () => {
      tmux("select-window", "-t", "main:0");
      await feed("main:1", "8 9");
      expect(status()).toBe("⏳");
      const mark = screen().length;
      // display-popup はポップアップが閉じるまで戻らない
      const popup = Bun.spawn(
        [Bun.which("tmux") ?? "tmux", "display-popup", "-c", clientName(), "-E", "-w", "120", "-h", "20", "agent-ws watch --popup"],
        { env },
      );
      await until(
        "ポップアップが描かれる",
        () => screen().slice(mark),
        (s) => s.includes("Enter:移動") && s.includes("許可待ち"),
      );
      type("\r");
      await until("claude のウィンドウへ移る", activeWindow, (w) => w === "1");
      expect(await Promise.race([popup.exited, Bun.sleep(5000).then(() => "開いたまま")])).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "質問されると ❓。答えて完了すると戻る",
    async () => {
      await feed("main:1", "10 11");
      expect(status()).toBe("❓");
      await until("ステータスラインに ❓", statusLine, (s) => s === "❓");
      await feed("main:1", "12 13 14");
      expect(status()).toBe("");
    },
    TIMEOUT,
  );

  test(
    "jump でエージェントのペインへ移る",
    async () => {
      tmux("select-window", "-t", "main:0");
      const [{ pid }] = agentPids();
      tmux("send-keys", "-t", "main:0", `agent-ws jump ${pid}`, "Enter");
      await until("claude のウィンドウへ移る", activeWindow, (w) => w === "1");
    },
    TIMEOUT,
  );

  test(
    "SessionEnd が無くても、プロセスが消えれば一覧から消える",
    async () => {
      tmux("new-window", "-d", "-t", "main:3", "-n", "main", "-c", repo());
      tmux("send-keys", "-t", "main:3", "claude", "Enter");
      const second = await until("2体目が出る", agentPids, (ps) => ps.some((p) => p.cwd === repo()));
      const pid = second.find((p) => p.cwd === repo())?.pid ?? 0;
      process.kill(pid, "SIGKILL");
      await until("一覧から消える", agentPids, (ps) => !ps.some((p) => p.pid === pid));
    },
    TIMEOUT,
  );

  test(
    "claude を終了すると一覧から消え、記録も消える",
    async () => {
      tmux("send-keys", "-t", "main:1", "exit", "Enter");
      await until("一覧から消える", agentPids, (ps) => ps.length === 0);
      expect(readdirSync(path("state")).filter((f) => f.startsWith("e2e-"))).toEqual([]);
      await until(
        "常駐表示からも消える",
        () => capture("main:2"),
        (s) => !s.includes("入力待ち"),
      );
    },
    TIMEOUT,
  );
});
