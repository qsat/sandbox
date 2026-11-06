import type { FileChange } from "../shared/local-changes";

/** 表示の仕方。tree はフォルダーごとにまとめ、flat はパスの一覧 */
export type ViewMode = "tree" | "flat";

export type Row =
  | { kind: "dir"; id: string; path: string; name: string; depth: number; open: boolean; count: number }
  | { kind: "file"; id: string; file: FileChange; name: string; depth: number };

interface Dir {
  dirs: Map<string, Dir>;
  files: FileChange[];
  count: number;
}

function newDir(): Dir {
  return { dirs: new Map(), files: [], count: 0 };
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fileName = (f: FileChange) => f.path.split("/").pop() ?? f.path;

/** パスの区切りでフォルダーの木を組む。各フォルダーに、下にあるファイルの数（count）を持たせる */
function buildTree(files: FileChange[]): Dir {
  const root = newDir();
  for (const file of files) {
    let dir = root;
    root.count += 1;
    const parts = file.path.split("/");
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = newDir()));
      next.count += 1;
      dir = next;
    }
    dir.files.push(file);
  }
  return root;
}

/** ツリーに出るフォルダーのパスをすべて返す（「すべて閉じる」で、これを閉じたフォルダーにする） */
export function dirPaths(files: FileChange[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join("/"));
  }
  return [...paths].sort(byName);
}

/**
 * 画面に並ぶ行。
 * - tree: フォルダー（名前順）を先に、続けてファイル（名前順）。閉じている（collapsed にパスがある）フォルダーの下は出さない
 * - flat: パスの順にファイルだけ
 */
export function changeRows(files: FileChange[], mode: ViewMode, collapsed: ReadonlySet<string>): Row[] {
  if (mode === "flat") {
    return [...files]
      .sort((a, b) => byName(a.path, b.path))
      .map((file) => ({ kind: "file", id: `file:${file.path}`, file, name: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path, depth: 0 }));
  }
  const rows: Row[] = [];
  const walk = (dir: Dir, prefix: string, depth: number) => {
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      const child = dir.dirs.get(name)!;
      const path = `${prefix}${name}`;
      const open = !collapsed.has(path);
      rows.push({ kind: "dir", id: `dir:${path}`, path, name, depth, open, count: child.count });
      if (open) walk(child, `${path}/`, depth + 1);
    }
    for (const file of [...dir.files].sort((a, b) => byName(a.path, b.path))) {
      rows.push({ kind: "file", id: `file:${file.path}`, file, name: file.oldPath ? `${fileName(file)}（← ${file.oldPath}）` : fileName(file), depth });
    }
  };
  walk(buildTree(files), "", 0);
  return rows;
}
