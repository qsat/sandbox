import { bringClientTo, type GoContext, type Step } from "./go";

export interface EditPlanInput {
  /** エディターの作業ディレクトリ（worktree のパス） */
  cwd: string;
  /** 開くファイル（worktree からの相対パス、または絶対パス） */
  file: string;
  /** その worktree の tmux セッション（無ければ作る steps を持つ） */
  session: { name: string; steps: Step[] };
  /** 同じファイルのエディターのウィンドウ（editWindowName の名前）が既にあるか */
  windowExists: boolean;
  ctx: GoContext;
}

/** 文字列の短いハッシュ（djb2。ウィンドウ名の衝突を避けるためだけに使う） */
function shortHash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * ファイルごとのエディターのウィンドウ名。`edit-<ファイル名>-<パスのハッシュ>`。
 * tmux の対象の指定（session:window.pane）で区切りになる `.` と `:` は `_` にする。ファイル名が同じでも、パスが違えばウィンドウは別になる
 */
export function editWindowName(file: string) {
  const base = file.split("/").pop() || "file";
  return `edit-${base.replace(/[.:\s]/g, "_")}-${shortHash(file)}`;
}

/**
 * エディターを起動するコマンド。tmux のグローバルな環境の EDITOR を使う（`set-environment -g EDITOR nvim`）。
 * EDITOR に引数が入っていても動くよう、シェルが単語に分けて起動する。ファイル名は $0 で渡すので、シェルの構文として解釈されない
 */
export function editLaunch(file: string) {
  return ["sh", "-c", 'exec ${EDITOR:-vi} "$0"', file.startsWith("-") ? `./${file}` : file];
}

/** `ws edit --file` の値を検査する。空と NUL は受け付けない */
export function parseEditFile(file: string | undefined) {
  if (file === undefined || file.trim() === "") throw new Error("ws edit <worktree> --file <path> [--client <name> | --from-app]");
  if (file.includes("\0")) throw new Error(`--file にはファイルのパスを指定してください: ${file}`);
  return file;
}

/**
 * ファイルをエディターで開く計画。
 * - 同じファイルのウィンドウが既にある: 何も起動せず、そのウィンドウへ移る（エディターを止めない。保存していない編集を失わないため）
 * - 無い: tmux セッション（無ければ作る）に、そのファイル専用のウィンドウを作って EDITOR を起動し、クライアントをそこへ移す
 * エディターを終えるとウィンドウは閉じる
 */
export function planEdit(input: EditPlanInput): Step[] {
  const window = editWindowName(input.file);
  const bring = bringClientTo(`${input.session.name}:${window}`, input.ctx);
  if (input.windowExists) return bring;
  return [...input.session.steps, { op: "openEditWindow", session: input.session.name, window, cwd: input.cwd, argv: editLaunch(input.file) }, ...bring];
}
