import type { AppStore } from "../../redux/createStore.ts";
import { claude } from "../../redux/middlewares/claude/index.ts";
import { processes } from "../../redux/middlewares/processes/index.ts";
import type { Context } from "../context.ts";
import { start } from "./start.ts";

/**
 * ステータスラインの印: ステータスラインから呼ばれるので軽くする（プロセス一覧もリポジトリも調べず、生死の確認と中断の確認だけ）。
 * ここでステータスラインを描き直させると自分がまた呼ばれるので、statusLine は購読させない
 */
export const status = (ctx: Context): AppStore => start(ctx, [processes(), claude()]);
