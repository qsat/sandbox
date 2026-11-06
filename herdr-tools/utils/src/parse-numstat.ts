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
