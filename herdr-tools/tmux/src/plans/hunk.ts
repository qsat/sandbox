import { bringClientTo, type GoContext, type Step } from "./go";

export const HUNK_WINDOW = "hunk";

export interface HunkPlanInput {
  /** hunk の作業ディレクトリ（worktree のパス） */
  cwd: string;
  /** hunk の実行ファイル */
  hunkBin: string;
  /** 開くもの。commit があれば `hunk show <commit>`、無ければ未コミットの変更（`hunk diff`） */
  commit?: string;
  /** 開いたあとに移るファイル（worktree からの相対パス） */
  file?: string;
  /** その worktree の tmux セッション（無ければ作る steps を持つ） */
  session: { name: string; steps: Step[] };
  /** セッションの中に hunk という名前のウィンドウがあるか */
  windowExists: boolean;
  /** hunk のセッションが daemon に登録されているか（`hunk session get --repo <cwd>` が成功するか） */
  hunkSessionExists: boolean;
  ctx: GoContext;
}

export function hunkArgs(commit: string | undefined) {
  return commit ? ["show", commit] : ["diff"];
}

/**
 * ファイルの差分を hunk で開く計画。
 * - hunk のセッションがある: 中身を入れ替える（reload）。hunk ウィンドウがあればそこへ移る。無ければ（tmux の外や別の名前で開いている）移らない
 * - セッションが無くウィンドウも無い: tmux セッション（無ければ作る）に hunk ウィンドウを作って起動する
 * - セッションが無いがウィンドウはある（hunk が終わっている、または起動中）: そのペインを respawn-pane -k で作り直す
 * 起動・入れ替えのあと、クライアントを hunk ウィンドウへ移し、最後に navigate でファイルへ移る（起動直後はセッションが現れるまで待つ）
 */
export function planHunk(input: HunkPlanInput): Step[] {
  const args = hunkArgs(input.commit);
  const navigate: Step[] = input.file ? [{ op: "hunkNavigate", cwd: input.cwd, file: input.file, wait: !input.hunkSessionExists }] : [];
  const bring = bringClientTo(`${input.session.name}:${HUNK_WINDOW}`, input.ctx);
  const launch = [input.hunkBin, ...args];
  if (input.hunkSessionExists) {
    const reload: Step = { op: "hunkReload", cwd: input.cwd, hunkBin: input.hunkBin, args };
    return [reload, ...(input.windowExists ? bring : []), ...navigate];
  }
  if (input.windowExists) {
    return [{ op: "respawnHunkWindow", session: input.session.name, cwd: input.cwd, argv: launch }, ...bring, ...navigate];
  }
  return [...input.session.steps, { op: "openHunkWindow", session: input.session.name, cwd: input.cwd, argv: launch }, ...bring, ...navigate];
}
