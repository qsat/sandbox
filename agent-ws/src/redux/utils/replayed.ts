import type { UnknownAction } from "@reduxjs/toolkit";

/** ログから流し直した出来事の目印。記録済みなので、もう一度記録したり知らせたりしない */
export const replayed = <A extends UnknownAction>(action: A): A => ({ ...action, meta: { replayed: true } });

export const isReplayed = (action: unknown): boolean => (action as { meta?: { replayed?: boolean } } | null)?.meta?.replayed === true;

/** このプロセスで起きた出来事（読み直したものではない）。listener の matcher に使う */
export const isFresh = (action: unknown): action is UnknownAction => !isReplayed(action);
