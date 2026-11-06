/**
 * git の出力を読む処理（I/O なし）。
 * 引数の組み立てと出力の読み取りをここに置き、exec は main.ts だけが呼ぶ。
 */

import { parseNumstat } from "@herdr-tools/utils/parse-numstat";
import type { FileChange } from "../shared/local-changes";

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

/** 範囲に合わせた、比べる相手のブランチ（push 前なら上流のブランチ、ベースからならベースブランチ）。all と、ベースが分からないときは null */
export function compareRef(range: HistoryRange, baseRef: string | null = null) {
  if (range === "unpushed") return "@{upstream}";
  if (range === "base") return baseRef;
  return null;
}

/**
 * 未コミットの変更も含めたブランチの差分の起点（分かれた点のコミット）を求める引数。
 * 出てきたハッシュと作業ツリーを hunk diff <hash> で比べる（git diff --merge-base <ref> と同じ。hunk は - で始まる引数を受け付けないので先に求める）
 */
export function mergeBaseArgs(ref: string) {
  return ["merge-base", ref, "HEAD"];
}

/** `git symbolic-ref refs/remotes/origin/HEAD` の出力（refs/remotes/origin/main）から、表示と git に渡す名前（origin/main）を作る */
export function shortRef(ref: string) {
  return ref.trim().replace(/^refs\/(remotes|heads)\//, "");
}

/** ボタンに出すベースブランチの名前。リモートの名前（origin/）は外す */
export function branchLabel(ref: string) {
  return ref.replace(/^origin\//, "");
}

/**
 * プルリクエストの base ブランチ（`gh pr view --json baseRefName` の値）を、git log に渡す ref にする。
 * リモートのブランチ（origin/<base>）を先に、無ければ手元のブランチを使う。どちらも無ければ null
 */
export function prBaseRef(baseRefName: string, exists: (ref: string) => boolean) {
  const name = baseRefName.trim();
  if (!name) return null;
  if (exists(`refs/remotes/origin/${name}`)) return `origin/${name}`;
  if (exists(`refs/heads/${name}`)) return name;
  return null;
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

export interface NameStatusEntry {
  status: string;
  path: string;
  oldPath?: string;
}

function statusLetter(code: string) {
  const c = code[0] ?? "M";
  return c === "C" ? "R" : c === "T" ? "M" : c;
}

/** `git show --name-status -z` を読む。名前の変更・コピーは「R100 NUL 旧 NUL 新 NUL」 */
export function parseNameStatus(stdout: string): NameStatusEntry[] {
  const tokens = stdout.split("\0");
  const out: NameStatusEntry[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i];
    if (!code) break;
    if (code[0] === "R" || code[0] === "C") {
      out.push({ status: statusLetter(code), oldPath: tokens[i + 1] ?? "", path: tokens[i + 2] ?? "" });
      i += 3;
    } else {
      out.push({ status: statusLetter(code), path: tokens[i + 1] ?? "" });
      i += 2;
    }
  }
  return out;
}

/** コミットで変わったファイル = name-status（種類）に numstat（行数）を path で合わせる */
export function commitFiles(nameStatus: string, numstat: string): FileChange[] {
  const stats = new Map(parseNumstat(numstat).map((e) => [e.path, e]));
  return parseNameStatus(nameStatus).map((e) => {
    const s = stats.get(e.path);
    return { ...e, add: s?.add ?? 0, del: s?.del ?? 0, binary: s?.binary ?? false };
  });
}

/** コミットで変わったファイルの一覧を読む `git show` の引数（numstat と name-status は同時に指定できないので 2 回に分ける） */
export function showFilesArgs(hash: string, kind: "numstat" | "name-status") {
  return ["show", hash, "--format=", `--${kind}`, "-z", "-M", "-m", "--first-parent"];
}
