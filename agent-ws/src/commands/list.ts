import type { AppStore } from "../redux/createStore.ts";
import { interruptionChecks } from "../redux/listeners/claude/index.ts";
import { dirtyCounts, repositories } from "../redux/listeners/git/index.ts";
import { processList, processLiveness } from "../redux/listeners/processes/index.ts";
import { start } from "./start.ts";
import type { Context, Of } from "./types.ts";

/** 一覧: エージェントのプロセス・リポジトリ構成・変更件数を1回調べる */
export const list = (c: Of<"list">, ctx: Context): AppStore =>
  start(ctx, [
    ...processLiveness(),
    ...processList({ self: ctx.pid }),
    ...dirtyCounts({ filter: c.filter }), // repositories より先に組む
    ...repositories({ ghq: ctx.ghq, query: c.query }),
    ...interruptionChecks(),
  ]);
