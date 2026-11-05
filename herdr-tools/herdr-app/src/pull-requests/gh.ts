/**
 * gh（GitHub の CLI）の出力を読む処理（I/O なし）。
 * 引数の組み立てと出力の読み取りをここに置き、exec は main.ts だけが呼ぶ。
 */

export const PR_LIST_ARGS = ["pr", "list", "--state", "open", "--limit", "30", "--json", "number,title,author,headRefName,baseRefName,isDraft,updatedAt,url"];

/** プルリクエストのコミットの一覧を読む引数 */
export function prCommitsArgs(number: number) {
  return ["pr", "view", String(number), "--json", "commits"];
}

export interface PullRequest {
  number: number;
  title: string;
  /** 作者の login。無ければ空 */
  author: string;
  headRef: string;
  baseRef: string;
  isDraft: boolean;
  /** 更新日時（unix 秒） */
  updatedAt: number;
  url: string;
}

export interface PrCommit {
  hash: string;
  short: string;
  author: string;
  /** 日時（unix 秒） */
  time: number;
  subject: string;
}

function json(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const sec = (v: unknown) => {
  const ms = Date.parse(str(v));
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** `gh pr list --json ...` の出力を読む。壊れていれば空。作者が無い（削除されたアカウントなど）ときは空の文字列 */
export function parsePrList(stdout: string): PullRequest[] {
  const v = json(stdout);
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    const r = obj(raw);
    if (typeof r.number !== "number") return [];
    return [
      {
        number: r.number,
        title: str(r.title),
        author: str(obj(r.author).login),
        headRef: str(r.headRefName),
        baseRef: str(r.baseRefName),
        isDraft: r.isDraft === true,
        updatedAt: sec(r.updatedAt),
        url: str(r.url),
      },
    ];
  });
}

/** `gh pr view --json commits` の出力を読み、新しい順（git log と同じ）にする。gh は古い順で返す */
export function parsePrCommits(stdout: string): PrCommit[] {
  const commits = obj(json(stdout)).commits;
  if (!Array.isArray(commits)) return [];
  return commits
    .flatMap((raw) => {
      const c = obj(raw);
      const hash = str(c.oid);
      if (!hash) return [];
      const first = obj(Array.isArray(c.authors) ? c.authors[0] : null);
      return [{ hash, short: hash.slice(0, 7), author: str(first.name) || str(first.login), time: sec(c.committedDate) || sec(c.authoredDate), subject: str(c.messageHeadline) }];
    })
    .reverse();
}

export const NO_PULL_REQUESTS_MESSAGE = "開いているプルリクエストはありません";

/**
 * gh が失敗したときに一覧の代わりに出す文。r が null のときは gh を起動できなかった（インストールされていない）。
 * 見分けられない失敗は、gh の標準エラーの 1 行目をそのまま出す
 */
export function ghFailureMessage(r: { code: number; stderr: string } | null): string {
  if (r === null || r.code === 127) return "gh（GitHub の CLI）が見つかりません。インストールすると、プルリクエストが出ます";
  const err = r.stderr.trim();
  if (/gh auth login|GH_TOKEN|not logged in|authentication/i.test(err)) return "gh が GitHub にログインしていません。gh auth login を実行してください";
  if (/none of the git remotes|no git remotes|known GitHub host|not a git repository/i.test(err)) return "GitHub のリポジトリではないので、プルリクエストを出せません";
  return `gh pr list が失敗しました: ${err.split("\n")[0] || `exit ${r.code}`}`;
}
