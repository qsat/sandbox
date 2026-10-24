/**
 * 意図（〜してほしい）のアクション。CLI と UI はこれを dispatch するだけで、I/O は listener（effects.ts）が受け持つ。
 * 結果は事実のアクション（logReplayed・reposScanned・jumped など）として Store に戻る。
 *
 * listener の処理は await を含まない限り dispatch の中で同期的に終わるので、dispatch の直後に状態を読んでよい。
 */
import { createAction } from "@reduxjs/toolkit";
import type { JumpTarget, Pid } from "../domain/model.ts";
import type { Filter } from "../domain/workspace.ts";
import type { HookInput } from "./claude.ts";

/** ログからセッションを組み立てる（ids を省くと全セッション） */
export const sessionsRequested = createAction<{ ids?: string[] } | undefined>("intent/sessionsRequested");
/** ログの変化を取り込む（他のプロセスが追記・削除した分だけ） */
export const logsChanged = createAction("intent/logsChanged");
/** プロセスが消えたセッションを閉じ、hook の届かない中断を拾う */
export const settleRequested = createAction<{ at: number }>("intent/settleRequested");
/** Claude Code の hook が呼ばれた */
export const hookReceived = createAction<{ input: HookInput; at: number }>("intent/hookReceived");

export const reposRequested = createAction<{ roots: string[]; query?: string }>("intent/reposRequested");
export const processesRequested = createAction("intent/processesRequested");
/** 変更件数は表示する worktree だけ数える */
export const dirtyRequested = createAction<{ filter: Filter }>("intent/dirtyRequested");

/** そのペインで完了したセッションを既読にする（tmux の pane-focus-in とポップアップからの移動） */
export const seenInPaneRequested = createAction<{ panePid: Pid; at: number }>("intent/seenInPaneRequested");
/** 行の指す先の tmux ペインへ移動する。見つからず create なら新しいウィンドウを開く。結果は jumped で戻る */
export const jumpRequested = createAction<{ target: JumpTarget; create: boolean; dryRun?: boolean }>("intent/jumpRequested");

/** watch の常駐を始める。プロセス・変更件数は interval ごと、リポジトリ構成は15秒ごと、ログは変化したときに取り込む */
export const watchStarted = createAction<{ roots: string[]; query?: string; filter: Filter; intervalMs: number }>("intent/watchStarted");
