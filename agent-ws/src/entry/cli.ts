#!/usr/bin/env bun
/**
 * agent-ws のプロセスの境界: 引数・環境変数・標準入力を読み、コマンドを実行し、標準出力と終了コードに書く
 * 使い方は utils/command.ts の USAGE
 *
 * 構成（依存は矢印の向きだけ。src/__tests__/layers.test.ts で確かめている）:
 *   entry（cli と境界の補助 utils）→ commands → ui・redux/listeners → redux/createStore・rootReducer → redux/modules → redux/types・utils → lib
 *     entry: この cli.ts と、境界の補助（utils: 引数 → Command、環境変数・時刻 → Context）
 *     commands: コマンドごとに listener・購読者を選んで Store を作り、出来事を伝える。結果は状態
 *     ui: 人に見せる（状態 → 文字・画面、ステータスラインの描き直し・通知）。listener は知らない
 *     redux/listeners: 外部システムとのやりとり。出来事に反応して I/O し、結果を出来事として戻す
 *     redux/modules: ドメイン（slice・selector）。I/O を知らない
 */
import { appendFileSync } from "node:fs";
import { hook } from "../commands/hook.ts";
import { jump } from "../commands/jump.ts";
import { list } from "../commands/list.ts";
import { seen } from "../commands/seen.ts";
import { status } from "../commands/status.ts";
import type { Command, Of } from "../commands/types.ts";
import { watch, watchControls } from "../commands/watch.ts";
import { attempt } from "../lib/attempt.ts";
import { match } from "../lib/match.ts";
import { realPath } from "../lib/run.ts";
import { hooksConfig } from "../redux/listeners/claude/hook.ts";
import { selectArrived } from "../redux/modules/ui/visit/selector.ts";
import { jumpText } from "../ui/jump.ts";
import { listRows, listText } from "../ui/list.ts";
import { statusText } from "../ui/status.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { runTui, type Terminal } from "../ui/tui.ts";
import { watchViewOf } from "../ui/watch.ts";
import { parseCommand } from "./utils/command.ts";
import { contextOf, displayOf } from "./utils/context.ts";

const ctx = contextOf(process.env, Date.now(), { pid: process.pid, ppid: process.ppid, platform: process.platform });
const display = displayOf(process.stdout, process.env);
const print = (text: string) => console.log(text);

/** ステータスラインに埋め込むときは tmux の書式で色を付ける */
const statusColor = (c: Of<"status">): ColorMode => {
  if (c.tmux) return "tmux";
  return display.color;
};

/** Claude Code の hook から呼ばれる。失敗しても Claude Code の動作は止めない */
async function receiveHook(): Promise<void> {
  const input = await Bun.stdin.text();
  // 入力の確認用: 受け取った JSON をそのまま1行ずつ追記する
  if (ctx.dump) attempt(() => appendFileSync(ctx.dump ?? "", `${input.replace(/\n/g, " ")}\n`), undefined);
  attempt(() => hook(JSON.parse(input || "{}"), ctx), undefined);
}

/** 常駐表示の端末: 標準入出力。Ctrl-C や kill で終わらせる */
const terminal: Terminal = {
  input: process.stdin,
  output: process.stdout,
  onStop: (stop) => void process.on("SIGINT", stop).on("SIGTERM", stop),
  exit: () => process.exit(0),
};

/** 常駐表示: 状態が変わるたびに描き直し、人の操作を出来事として伝える */
function runWatch(c: Of<"watch">): void {
  const store = watch(c, ctx);
  runTui({
    terminal,
    rows: () => listRows(store.getState(), c.filter, display.home),
    view: () => watchViewOf(store.getState()),
    subscribe: (onChange) => void store.subscribe(onChange),
    ...watchControls(store),
    color: display.color,
  });
}

function runJump(c: Of<"jump">): void {
  const st = jump(c, ctx).getState();
  print(jumpText(st, c.target, display.color));
  if (!selectArrived(st)) process.exitCode = 1;
}

const run = (command: Command) =>
  match(command, {
    list: (c) => print(listText(list(c, ctx).getState(), c, display)),
    watch: runWatch,
    status: (c) => print(statusText(status(ctx).getState(), statusColor(c))),
    seen: (c) => void seen(c, ctx),
    jump: runJump,
    hook: receiveHook,
    hooksConfig: () => print(JSON.stringify(hooksConfig(process.execPath, realPath(process.argv[1])), null, 2)),
    usage: (c) => {
      console.error(c.message);
      process.exitCode = 2;
    },
  });

await run(parseCommand(process.argv.slice(2), process.cwd()));
