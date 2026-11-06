import { parseNumstat } from "@herdr-tools/utils/parse-numstat";

/**
 * worktree の変更量。ベースブランチから分かれた点と作業ツリーの差を、足した行と消した行の数で表す。
 * コミット済み・未コミットの変更・追跡されていないファイル（足した行に数える）を含む。バイナリは数えない
 */
export interface ChangeAmount {
  added: number;
  deleted: number;
}

export const NO_CHANGE: ChangeAmount = { added: 0, deleted: 0 };

/** 追跡されていないファイルを数える上限。これを超えるファイル・ファイル数は数えない（ビルドの出力を ignore し忘れたときに重くしない） */
export const UNTRACKED_MAX_FILES = 200;
export const UNTRACKED_MAX_BYTES = 1024 * 1024;

/** `git diff --numstat -z --no-renames` の出力の行数を足す。バイナリ（行数が `-`）は数えない */
export function amountOfNumstat(stdout: string): ChangeAmount {
  return parseNumstat(stdout)
    .filter((e) => !e.binary)
    .reduce((sum, e) => ({ added: sum.added + e.add, deleted: sum.deleted + e.del }), NO_CHANGE);
}

/** テキストの行数（最後の行に改行が無くても 1 行と数える）。NUL を含むものはバイナリとして数えない */
export function countTextLines(text: string) {
  if (text.includes("\0")) return 0;
  if (text === "") return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}
