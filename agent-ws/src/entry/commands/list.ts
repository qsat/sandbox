import type { AppStore } from "../../redux/createStore.ts";
import { claude } from "../../redux/middlewares/claude/index.ts";
import { git } from "../../redux/middlewares/git/index.ts";
import { processes } from "../../redux/middlewares/processes/index.ts";
import { start } from "./start.ts";
import type { Context, Of } from "./types.ts";

/** 一覧: エージェントのプロセス・リポジトリ構成・変更件数を1回調べる */
export const list = (c: Of<"list">, ctx: Context): AppStore =>
  start(ctx, [
    processes({ list: true, self: ctx.pid }),
    git({ ghq: ctx.ghq, repos: { query: c.query }, dirty: c.filter }),
    claude({ parent: ctx.ppid }),
  ]);
