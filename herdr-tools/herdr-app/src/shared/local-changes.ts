/**
 * 変更のあったファイルの一覧（各ファイルの +足した行 −消した行）を読む処理。
 * 未コミットの変更（git status の追跡していないファイルを含む）と、比べる相手のブランチとの差（作業ツリーまで）と、コミットで変わったファイル。
 * commit-history と worktree-changes が共通に使う。判断は I/O なし、git の呼び出しは引数で受ける。
 */

import { parseNumstat, type NumstatEntry } from "@herdr-tools/utils/parse-numstat";
import { mergeBaseArgs } from "./base-ref";

export interface FileChange {
  /** A 追加 / M 変更 / D 削除 / R 名前の変更 / U 競合 / ? 追跡されていない */
  status: string;
  path: string;
  oldPath?: string;
  add: number;
  del: number;
  binary: boolean;
}

export interface StatusEntry {
  status: string;
  path: string;
  oldPath?: string;
}

/** `git status --porcelain=v1 -z` を読む。名前の変更は「XY 新 NUL 旧 NUL」の順 */
export function parseStatus(stdout: string): StatusEntry[] {
  const tokens = stdout.split("\0");
  const out: StatusEntry[] = [];
  for (let i = 0; i < tokens.length; ) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) {
      i += 1;
      continue;
    }
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const renamed = xy.includes("R") || xy.includes("C");
    const status =
      xy === "??" ? "?" : xy.includes("U") || xy === "AA" || xy === "DD" ? "U" : renamed ? "R" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
    out.push(renamed ? { status, path, oldPath: tokens[i + 1] ?? "" } : { status, path });
    i += renamed ? 2 : 1;
  }
  return out;
}

/** 複数の numstat（HEAD が無いときのステージ済みと未ステージ）を path ごとに足す */
export function sumNumstat(...outputs: string[]): Map<string, NumstatEntry> {
  const sum = new Map<string, NumstatEntry>();
  for (const out of outputs) {
    for (const e of parseNumstat(out)) {
      const old = sum.get(e.path);
      sum.set(e.path, { path: e.path, add: (old?.add ?? 0) + e.add, del: (old?.del ?? 0) + e.del, binary: (old?.binary ?? false) || e.binary });
    }
  }
  return sum;
}

/** 未コミットで変わったファイル = status（種類）に numstat（行数）を path で合わせる。追跡されていないファイルは行数が無い */
export function localFiles(status: string, stats: Map<string, NumstatEntry>): FileChange[] {
  return parseStatus(status).map((e) => {
    const s = stats.get(e.path);
    return { ...e, add: s?.add ?? 0, del: s?.del ?? 0, binary: s?.binary ?? false };
  });
}


export interface GitResult {
  code: number;
  stdout: string;
}

/** 未コミットの変更を読む git の引数（HEAD がある・無いで numstat の取り方が違う） */
export const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
export const HEAD_ARGS = ["rev-parse", "--verify", "HEAD"];
export function numstatArgs(hasHead: boolean): string[][] {
  return hasHead ? [["diff", "HEAD", "--numstat", "-z", "--no-renames"]] : [["diff", "--cached", "--numstat", "-z", "--no-renames"], ["diff", "--numstat", "-z", "--no-renames"]];
}

/** worktree の未コミットの変更を読む。git の呼び出し（git 引数 → 結果）は呼ぶ側が渡す。status が失敗したら空 */
export async function readLocalFiles(git: (args: string[]) => Promise<GitResult>, hasHead: boolean): Promise<FileChange[]> {
  const status = await git(STATUS_ARGS);
  const numstats: GitResult[] = [];
  for (const args of numstatArgs(hasHead)) numstats.push(await git(args));
  return status.code === 0 ? localFiles(status.stdout, sumNumstat(...numstats.map((n) => n.stdout))) : [];
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

/** 比べる相手との差を読む git の引数（name-status と numstat は同時に指定できないので 2 回に分ける。リネームは commit-history のコミットのファイルと同じく -M で検出する） */
export function diffFilesArgs(base: string, kind: "numstat" | "name-status") {
  return ["diff", base, `--${kind}`, "-z", "-M"];
}

/**
 * 分かれた点（base）と作業ツリーの差 = name-status と numstat に、追跡していないファイル（git status の ?）を足す。
 * base からの差には、ステージ済み・未ステージの変更とコミット済みの変更がすべて入る
 */
export function rangeFiles(nameStatus: string, numstat: string, status: string): FileChange[] {
  const untracked = parseStatus(status)
    .filter((e) => e.status === "?")
    .map((e): FileChange => ({ ...e, add: 0, del: 0, binary: false }));
  return [...commitFiles(nameStatus, numstat), ...untracked];
}

/**
 * 比べる相手のブランチ（ref）から分かれた点と、作業ツリーの差を読む。git の呼び出しは呼ぶ側が渡す。
 * 分かれた点が求まらない（上流のブランチが無い・ref が無い・履歴が交わらない）ときは null、差の読み取りに失敗したときは空
 */
export async function readRangeFiles(git: (args: string[]) => Promise<GitResult>, ref: string): Promise<FileChange[] | null> {
  const mergeBase = await git(mergeBaseArgs(ref));
  const base = mergeBase.stdout.trim();
  if (mergeBase.code !== 0 || !base) return null;
  const [names, stats, status] = await Promise.all([git(diffFilesArgs(base, "name-status")), git(diffFilesArgs(base, "numstat")), git(STATUS_ARGS)]);
  return names.code === 0 && stats.code === 0 && status.code === 0 ? rangeFiles(names.stdout, stats.stdout, status.stdout) : [];
}
