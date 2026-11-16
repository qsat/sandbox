import type { FileChange } from "../shared/local-changes";
import type { Commit } from "./git";

export const LOCAL_ID = "local";

export type Row =
  | { kind: "local"; id: string; count: number; open: boolean }
  | { kind: "commit"; id: string; commit: Commit; open: boolean }
  | { kind: "file"; id: string; owner: string; file: FileChange };

type HeadRow = Extract<Row, { kind: "local" | "commit" }>;

/**
 * コミットを順に見ていくとき（ctrl-j / ctrl-k）に選ぶ行。「未コミットの変更」とコミットの行だけを数え、ファイルの行は飛ばす。
 * ファイルの行にいるときは、そのファイルの持ち主（コミットか「未コミットの変更」）の行にいるものとして数える。端で止まる。
 * 何も選んでいなければ、下へは先頭、上へは最後の行
 */
export function moveToHeadRow(rows: Row[], current: string | null, delta: 1 | -1): HeadRow | null {
  const heads = rows.filter((r): r is HeadRow => r.kind !== "file");
  if (heads.length === 0) return null;
  const at = rows.find((r) => r.id === current);
  const owner = at?.kind === "file" ? at.owner : null;
  const i = heads.findIndex((h) => (owner === null ? h.id === current : owner === (h.kind === "local" ? LOCAL_ID : h.commit.hash)));
  if (i < 0) return (delta === 1 ? heads[0] : heads.at(-1)) ?? null;
  return heads[Math.min(heads.length - 1, Math.max(0, i + delta))] ?? null;
}

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
