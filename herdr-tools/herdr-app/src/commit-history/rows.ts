import type { Commit, FileChange } from "./git";

export const LOCAL_ID = "local";

export type Row =
  | { kind: "local"; id: string; count: number; open: boolean }
  | { kind: "commit"; id: string; commit: Commit; open: boolean }
  | { kind: "file"; id: string; owner: string; file: FileChange };

/**
 * 画面に並ぶ行。先頭に「未コミットの変更」（変更があるときだけ）、続けてコミット（新しい順）。
 * 開いている行（expanded。同時に 1 つだけ）の下に、変わったファイルが並ぶ
 */
export function visibleRows(commits: Commit[], local: FileChange[], expanded: string | null, filesOf: Map<string, FileChange[]>): Row[] {
  const fileRows = (owner: string, files: FileChange[] | undefined): Row[] =>
    (files ?? []).map((file) => ({ kind: "file", id: `file:${owner}:${file.path}`, owner, file }));
  const rows: Row[] = [];
  if (local.length > 0) {
    const open = expanded === LOCAL_ID;
    rows.push({ kind: "local", id: LOCAL_ID, count: local.length, open }, ...(open ? fileRows(LOCAL_ID, local) : []));
  }
  for (const commit of commits) {
    const open = expanded === commit.hash;
    rows.push({ kind: "commit", id: `commit:${commit.hash}`, commit, open }, ...(open ? fileRows(commit.hash, filesOf.get(commit.hash)) : []));
  }
  return rows;
}

export function moveSelection(rows: Row[], current: string | null, delta: 1 | -1): string | null {
  if (rows.length === 0) return null;
  const i = current ? rows.findIndex((r) => r.id === current) : -1;
  if (i < 0) return (delta === 1 ? rows[0] : rows.at(-1))?.id ?? null;
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))]?.id ?? null;
}
