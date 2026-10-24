import type { AppStore } from "../../redux/createStore.ts";
import { claude } from "../../redux/middlewares/claude/index.ts";
import { git } from "../../redux/middlewares/git/index.ts";
import { processes } from "../../redux/middlewares/processes/index.ts";
import type { Of } from "../command.ts";
import type { Context } from "../context.ts";
import { start } from "./start.ts";

/** 一覧: エージェントのプロセス・リポジトリ構成・変更件数を1回調べる */
export const list = (c: Of<"list">, ctx: Context): AppStore =>
  start(ctx, [processes({ list: true }), git({ ghq: ctx.ghq, repos: { query: c.query }, dirty: c.filter }), claude()]);
