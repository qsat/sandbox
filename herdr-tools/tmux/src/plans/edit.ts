import { bringClientTo, type GoContext, type Step } from "./go";

export interface EditPlanInput {
  /** エディターの作業ディレクトリ（worktree のパス） */
  cwd: string;
  /** 開くファイル（worktree からの相対パス、または絶対パス） */
  file: string;
  /** その worktree の tmux セッション（無ければ作る steps を持つ） */
  session: { name: string; steps: Step[] };
  /** tmux のグローバルな環境の EDITOR（無ければ空） */
  editor: string;
  /** その tmux セッションの nvim が待ち受けるソケットのパス（editSocketPath） */
  socket: string;
  /** 使い回すウィンドウ（SHARED_EDIT_WINDOW）が既にあるか */
  sharedWindowExists: boolean;
  /** そのソケットの nvim が応答するか */
  serverResponds: boolean;
  /** 同じファイルのウィンドウ（editWindowName の名前）が既にあるか */
  fileWindowExists: boolean;
  ctx: GoContext;
}

/** worktree の tmux セッションごとに 1 つだけ使う、nvim のウィンドウの名前 */
export const SHARED_EDIT_WINDOW = "edit";

/** unix ソケットのパスの長さの上限（macOS は 104 バイトで、終端の NUL を含む）。超えると nvim が --listen できない */
const SOCKET_PATH_MAX = 100;

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

/** EDITOR が nvim（`--listen` / `--server` を持つエディター）なら、その実行ファイル（EDITOR の最初の単語）。違えば undefined */
export function serverEditorBin(editor: string) {
  const bin = editor.trim().split(/\s+/)[0] ?? "";
  return bin.split("/").pop() === "nvim" ? bin : undefined;
}

/** tmux セッション名から、nvim のソケットのファイル名（`<sanitized>-<hash>.sock`）。unix ソケットのパスは長さに上限があるので、名前は 24 文字までにする */
export function editSocketPath(dir: string, session: string) {
  const safe = session.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24);
  return `${dir.replace(/\/$/, "")}/${safe}-${shortHash(session)}.sock`;
}

/** ファイルの絶対パス（nvim --remote は nvim の作業ディレクトリで解釈するので、絶対パスで渡す） */
export function absoluteFile(cwd: string, file: string) {
  return file.startsWith("/") ? file : `${cwd.replace(/\/$/, "")}/${file.replace(/^\.\//, "")}`;
}

/** nvim を `--listen` 付きで起動するコマンド。前の nvim が残した（応答しない）ソケットのファイルは bind できないので消してから起動する。引数は $0（EDITOR 以外の位置引数）で渡す */
export function serverLaunch(socket: string, file: string) {
  return ["sh", "-c", 'rm -f "$0"; exec ${EDITOR:-vi} --listen "$0" "$1"', socket, file.startsWith("-") ? `./${file}` : file];
}

/**
 * ファイルをエディターで開く計画。
 * - EDITOR が nvim で、そのセッションの `edit` ウィンドウがあり nvim が応答する: 新しいウィンドウを作らず、その nvim に `--remote` でファイルを開かせ、クライアントをそのウィンドウへ移す
 * - EDITOR が nvim で、`edit` ウィンドウもソケットの nvim も無い: tmux セッション（無ければ作る）に `edit` ウィンドウを作り、`nvim --listen <ソケット>` でファイルを開いて、クライアントを移す
 * - それ以外は、ファイルごとのウィンドウ（今までの動き）に退く。nvim でないエディターはサーバー機能が無く、ソケットのパスが長すぎても --listen できない。
 *   `edit` ウィンドウはあるのに応答しない（起動中・固まっている・nvim を抜けてシェルが残っている）、
 *   または `edit` ウィンドウが無いのにソケットの nvim が応答する（別の場所で動いている）ときも、動いている nvim を止めず、巻き込まない
 * 退いた先では、同じファイルのウィンドウが既にあれば起動せずそこへ移る。エディターを終えるとウィンドウは閉じる
 */
export function planEdit(input: EditPlanInput): Step[] {
  const bin = serverEditorBin(input.editor);
  const shared = bin && input.socket.length <= SOCKET_PATH_MAX && input.sharedWindowExists === input.serverResponds;
  if (bin && shared) {
    const bring = bringClientTo(`${input.session.name}:${SHARED_EDIT_WINDOW}`, input.ctx);
    if (input.serverResponds) return [{ op: "remoteEdit", bin, socket: input.socket, file: absoluteFile(input.cwd, input.file) }, ...bring];
    return [...input.session.steps, { op: "openEditWindow", session: input.session.name, window: SHARED_EDIT_WINDOW, cwd: input.cwd, argv: serverLaunch(input.socket, input.file) }, ...bring];
  }
  const window = editWindowName(input.file);
  const bring = bringClientTo(`${input.session.name}:${window}`, input.ctx);
  if (input.fileWindowExists) return bring;
  return [...input.session.steps, { op: "openEditWindow", session: input.session.name, window, cwd: input.cwd, argv: editLaunch(input.file) }, ...bring];
}
