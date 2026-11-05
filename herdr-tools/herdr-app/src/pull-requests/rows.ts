import type { PrCommit, PullRequest } from "./gh";

export type Row =
  | { kind: "pr"; id: string; pr: PullRequest; open: boolean; /** 今のブランチのプルリクエスト */ current: boolean }
  | { kind: "commit"; id: string; prNumber: number; commit: PrCommit }
  | { kind: "note"; id: string; text: string };

/**
 * 画面に並ぶ行。今のブランチ（branch）のプルリクエストを先頭に置き、残りは gh が返した順（更新が新しい順）。
 * 開いている行（expanded。同時に 1 つだけ）の下に、そのプルリクエストのコミットが新しい順に並ぶ。
 * コミットを読み込み中（commitsOf に無い）なら、その旨の行を出す
 */
export function visibleRows(prs: PullRequest[], branch: string | null, expanded: number | null, commitsOf: Map<number, PrCommit[]>): Row[] {
  const isCurrent = (pr: PullRequest) => branch !== null && pr.headRef === branch;
  const ordered = [...prs.filter(isCurrent), ...prs.filter((p) => !isCurrent(p))];
  const rows: Row[] = [];
  for (const pr of ordered) {
    const open = expanded === pr.number;
    rows.push({ kind: "pr", id: `pr:${pr.number}`, pr, open, current: isCurrent(pr) });
    if (!open) continue;
    const commits = commitsOf.get(pr.number);
    if (!commits) rows.push({ kind: "note", id: `note:${pr.number}`, text: "Loading commits…" });
    else if (commits.length === 0) rows.push({ kind: "note", id: `note:${pr.number}`, text: "No commits" });
    else for (const commit of commits) rows.push({ kind: "commit", id: `commit:${pr.number}:${commit.hash}`, prNumber: pr.number, commit });
  }
  return rows;
}
