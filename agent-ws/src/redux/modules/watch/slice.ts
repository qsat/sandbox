import { createAction } from "@reduxjs/toolkit";
import type { Filter } from "../workspace/slice.ts";

/** watch の常駐を始める。プロセス・変更件数は interval ごと、リポジトリ構成は15秒ごと、ログは変化したときに取り込む */
export const watchStarted = createAction<{ roots: string[]; query?: string; filter: Filter; intervalMs: number }>("watch/started");
