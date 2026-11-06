import { worktreeDisplayName } from "@herdr-tools/utils/worktree-display-name";
import type { ListedTree } from "@herdr-tools/tmux/list-json";

/** picker の候補 1 つ。claude を起動する先の worktree */
export interface Candidate {
  /** worktree のパス（ws new に渡す） */
  path: string;
  /** workspace の名前（github.com/<owner>/<repo>） */
  workspace: string;
  /** worktree の名前（ブランチ名。無ければフォルダー名） */
  worktree: string;
  /** その worktree で動いているエージェントの数 */
  agents: number;
  /** workspace のパス（agent-board で畳んだ workspace を開くのに使う） */
  workspacePath: string;
  /** agent-board にもう出ている（`ws list --json` に入っている）か */
  onBoard: boolean;
}

/**
 * `ws list --json --all`（all）から候補を作る。場所が在る worktree だけ、ws list の並びのまま。
 * board は agent-board が出している `ws list --json` で、そこにある worktree は onBoard にする
 */
export function candidates(all: ListedTree, board: ListedTree): Candidate[] {
  const shown = new Set(board.workspaces.flatMap((ws) => ws.worktrees.map((wt) => wt.path)));
  return all.workspaces.flatMap((ws) =>
    ws.worktrees
      .filter((wt) => wt.exists)
      .map((wt) => ({ path: wt.path, workspace: ws.name, worktree: worktreeDisplayName(wt), agents: wt.agents.length, workspacePath: ws.path, onBoard: shown.has(wt.path) })),
  );
}

/** 選んだ候補ですること。ボードにあれば、その行を選ぶだけ。無ければ claude を起動してボードに出す */
export function pickAction(c: Candidate): { kind: "reveal"; path: string; workspacePath: string } | { kind: "launch"; args: string[] } {
  return c.onBoard ? { kind: "reveal", path: c.path, workspacePath: c.workspacePath } : { kind: "launch", args: wsNewArgs(c) };
}

/**
 * 打った文字の 1 語が、text の中に順に（飛び飛びでよい）含まれるかを調べ、含まれれば当てはまった範囲の長さを返す。
 * 短いほど文字がまとまって当てはまっている。大文字と小文字は区別しない
 */
export function subsequenceSpan(text: string, term: string): number | null {
  const s = text.toLowerCase();
  const q = term.toLowerCase();
  let best: number | null = null;
  // 1 文字目が当てはまる場所ごとに試し、範囲が一番短いものをとる
  for (let start = s.indexOf(q[0] ?? ""); start >= 0; start = s.indexOf(q[0] ?? "", start + 1)) {
    let i = start;
    let ok = true;
    for (const ch of q.slice(1)) {
      i = s.indexOf(ch, i + 1);
      if (i < 0) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    const span = i - start + 1;
    if (best === null || span < best) best = span;
  }
  return best;
}

/**
 * fzf のように絞り込む。空白で区切った語がすべて「workspace の名前と worktree の名前」に順に含まれる候補を残し、
 * 当てはまった範囲が短い順に並べる（同じなら元の並び）。何も打っていなければ元の並びのまま
 */
export function filterCandidates(items: Candidate[], query: string): Candidate[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  const scored = items.flatMap((c, order) => {
    const text = `${c.workspace} ${c.worktree}`;
    let total = 0;
    for (const term of terms) {
      const span = subsequenceSpan(text, term);
      if (span === null) return [];
      total += span;
    }
    return [{ c, total, order }];
  });
  return scored.sort((a, b) => a.total - b.total || a.order - b.order).map((x) => x.c);
}

/** 行に出す workspace の名前。幅を取らないよう、先頭のホスト名（github.com/ など）を省く。絞り込みには元の名前を使う */
export function shortWorkspace(name: string) {
  const parts = name.split("/");
  return parts.length > 2 ? parts.slice(1).join("/") : name;
}

/** 選んだ行を 1 つ動かす。端では反対の端へ回る */
export function moveCursor(at: number, length: number, delta: 1 | -1) {
  if (length === 0) return 0;
  return (at + delta + length) % length;
}

/** 選んだ候補で claude を起動する ws の引数。agent-board の「＋ claude」と同じく、起動して会話へ移る */
export function wsNewArgs(c: Candidate) {
  return ["new", c.path, "--attach", "--from-app"];
}
