/**
 * git の出力を読む処理（I/O なし）。
 * 引数の組み立てと出力の読み取りをここに置き、exec は main.ts だけが呼ぶ。
 */

/** `.git` に何も書かずに読む引数。`.git` を見張っているので、自分の読み取りで読み直しが繰り返されるのを防ぐ */
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export const LOG_LIMIT = 50;
export const LOG_ARGS = ["log", "-n", String(LOG_LIMIT), "--no-color", "--format=%x1e%H%x1f%h%x1f%an%x1f%at%x1f%D%x1f%s"];

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

export interface FileChange {
  /** A 追加 / M 変更 / D 削除 / R 名前の変更 / U 競合 / ? 追跡されていない */
  status: string;
  path: string;
  oldPath?: string;
  add: number;
  del: number;
  binary: boolean;
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

export function relativeTime(nowSec: number, thenSec: number): string {
  const d = Math.max(0, nowSec - thenSec);
  if (d < 60) return "たった今";
  if (d < 3600) return `${Math.floor(d / 60)} 分前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 時間前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 日前`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))} か月前`;
  return `${Math.floor(d / (86400 * 365))} 年前`;
}

export interface NumstatEntry {
  path: string;
  oldPath?: string;
  add: number;
  del: number;
  binary: boolean;
}

/** `git show/diff --numstat -z` を読む。名前の変更は「行数 TAB 空 NUL 旧 NUL 新 NUL」、バイナリの行数は `-` */
export function parseNumstat(stdout: string): NumstatEntry[] {
  const tokens = stdout.split("\0");
  const out: NumstatEntry[] = [];
  for (let i = 0; i < tokens.length; ) {
    const m = /^(\S+)\t(\S+)\t([\s\S]*)$/.exec(tokens[i] ?? "");
    if (!m) {
      i += 1;
      continue;
    }
    const binary = m[1] === "-";
    const stat = { add: Number(m[1]) || 0, del: Number(m[2]) || 0, binary };
    if (m[3] === "") {
      out.push({ ...stat, oldPath: tokens[i + 1] ?? "", path: tokens[i + 2] ?? "" });
      i += 3;
    } else {
      out.push({ ...stat, path: m[3]! });
      i += 1;
    }
  }
  return out;
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

/** コミットで変わったファイルの一覧を読む `git show` の引数（numstat と name-status は同時に指定できないので 2 回に分ける） */
export function showFilesArgs(hash: string, kind: "numstat" | "name-status") {
  return ["show", hash, "--format=", `--${kind}`, "-z", "-M", "-m", "--first-parent"];
}

/** ファイルの行を選んだときに `ws hunk` へ渡す引数。コミットの下なら `--commit <hash>`、未コミットの変更なら付けない */
export function wsHunkArgs(root: string, commit: string | null, file: Pick<FileChange, "path">) {
  return ["hunk", root, ...(commit ? ["--commit", commit] : []), "--file", file.path, "--from-app"];
}
