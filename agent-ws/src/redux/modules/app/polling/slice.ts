import { createAction } from "@reduxjs/toolkit";
import type { Filter } from "../../../types/workspace.ts";

/** 常駐（watch コマンド）の定期スキャンを始める。プロセス・変更件数は interval ごと、リポジトリ構成は15秒ごと、ログは変化したときに取り込む */
export const pollingStarted = createAction<{ roots: string[]; query?: string; filter: Filter; intervalMs: number }>("polling/started");
