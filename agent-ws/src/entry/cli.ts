#!/usr/bin/env bun
/**
 * agent-ws のプロセスの境界: 引数・環境変数・標準入力を読み、コマンドを実行し、標準出力と終了コードに書く
 * 使い方は command.ts の USAGE
 *
 * 構成（依存は矢印の向きだけ）:
 *   entry/cli.ts（プロセスの境界。context: 環境変数といまの時刻、command: 引数 → Command）
 *     ├→ entry/commands/*（コマンドごとに middleware・購読者を選んで Store を作り、出来事を伝える。結果は状態）
 *     │     ├→ redux/middlewares/*（外部システムとのやりとり: eventLog・claude・processes・git・tmux・clock）
 *     │     ├→ redux/subscribers/*（状態を人に見せる: statusLine・notifier）
 *     │     └→ redux/modules/{app,ui}/*（ドメイン: slice・selector・listener。I/O を知らない）
 *     └→ ui/*（表示: 状態 → 文字・画面）
 */
import { appendFileSync } from "node:fs";
import { attempt } from "../lib/attempt.ts";
import { match } from "../lib/match.ts";
import { hooksConfig } from "../redux/middlewares/claude/hook.ts";
import { realPath } from "../redux/middlewares/shared/shell.ts";
import { selectArrived } from "../redux/modules/ui/visit/selector.ts";
import { jumpText } from "../ui/jump.ts";
import { listRows, listText } from "../ui/list.ts";
import { statusText } from "../ui/status.ts";
import type { ColorMode } from "../ui/terminal.ts";
import { runWatch as runTui } from "../ui/watch.ts";
import { watchViewOf } from "../ui/watchView.ts";
import { type Command, type Of, parseCommand } from "./command.ts";
import { hook } from "./commands/hook.ts";
import { jump } from "./commands/jump.ts";
import { list } from "./commands/list.ts";
import { seen } from "./commands/seen.ts";
import { status } from "./commands/status.ts";
import { watch, watchControls } from "./commands/watch.ts";
import { contextOf, displayOf } from "./context.ts";

const ctx = contextOf(process.env, Date.now());
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

/** 常駐表示: 状態が変わるたびに描き直し、人の操作を出来事として伝える */
function runWatch(c: Of<"watch">): void {
  const store = watch(c, ctx);
  runTui({
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
