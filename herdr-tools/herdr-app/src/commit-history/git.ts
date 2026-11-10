/**
 * git の出力を読む処理（I/O なし）。
 * 引数の組み立てと出力の読み取りをここに置き、exec は main.ts だけが呼ぶ。
 */

import { compareRef } from "../shared/base-ref";

export const LOG_LIMIT = 50;
export const LOG_ARGS = ["log", "-n", String(LOG_LIMIT), "--no-color", "--format=%x1e%H%x1f%h%x1f%an%x1f%at%x1f%D%x1f%s"];

/**
 * 一覧に出すコミットの範囲。
 * all は HEAD からの履歴、unpushed は上流のブランチにまだ push していないもの、base はベースブランチから分かれた後のもの
 */
export type HistoryRange = "all" | "unpushed" | "base";

/**
 * 範囲に合わせた git log の引数。unpushed は上流のブランチが無いと git が失敗する（終了コード 128）。
 * base はベースブランチ（baseRef）が分からなければ null（git を呼ばない）
 */
export function logArgs(range: HistoryRange, baseRef: string | null = null) {
  if (range === "unpushed") return [...LOG_ARGS, "@{upstream}..HEAD"];
  if (range === "base") return baseRef ? [...LOG_ARGS, `${baseRef}..HEAD`] : null;
  return LOG_ARGS;
}

/**
 * 範囲に合わせた、ブランチ間の差分の範囲（hunk diff に渡す）。分かれた点から HEAD までの差分なので `...` を使う
 * （相手のブランチに後から入ったコミットは差分に混ざらない。GitHub のプルリクエストの差分と同じ）。
 * all はブランチ間の比較ではないので null、base はベースブランチが分からなければ null
 */
export function diffRange(range: HistoryRange, baseRef: string | null = null) {
  const ref = compareRef(range, baseRef);
  return ref ? `${ref}...HEAD` : null;
}

export interface Commit {
  hash: string;
  short: string;
  author: string;
  /** 作者の日時（unix 秒） */
  time: number;
  /** `%D` の各項目（例: `HEAD -> main`、`origin/main`、`tag: v1`）。無ければ空 */
  refs: string[];
  subject: string;
}

export function parseDecorations(raw: string): string[] {
  return raw
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `git log` の `LOG_ARGS` の出力を読む。コミットの先頭に 0x1e、項目の間に 0x1f がある */
export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\x1e")
    .map((r) => r.replace(/^\n+|\n+$/g, ""))
    .filter((r) => r !== "")
    .map((r) => {
      const [hash = "", short = "", author = "", at = "", refs = "", ...subject] = r.split("\x1f");
      return { hash, short, author, time: Number(at) || 0, refs: parseDecorations(refs), subject: subject.join("\x1f") };
    });
}

/** コミットで変わったファイルの一覧を読む `git show` の引数（numstat と name-status は同時に指定できないので 2 回に分ける） */
export function showFilesArgs(hash: string, kind: "numstat" | "name-status") {
  return ["show", hash, "--format=", `--${kind}`, "-z", "-M", "-m", "--first-parent"];
}
