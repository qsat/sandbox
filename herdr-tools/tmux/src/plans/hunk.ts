import { bringClientTo, type GoContext, type Step } from "./go";

export const HUNK_WINDOW = "hunk";

export interface HunkPlanInput {
  /** hunk の作業ディレクトリ（worktree のパス） */
  cwd: string;
  /** hunk の実行ファイル */
  hunkBin: string;
  /** 開くもの。commit があれば `hunk show <commit>`（手元のコミット）、無ければ未コミットの変更（`hunk diff`） */
  commit?: string;
  /** GitHub のプルリクエスト全体（`hunk gh pr <番号>`）。commit より優先する */
  pr?: string;
  /** GitHub のコミット（`hunk gh commit <sha>`）。手元に無いコミット用。pr の次に優先する */
  ghCommit?: string;
  /** ブランチ間の差分（`hunk diff <range>`。例: `origin/main...HEAD`）。ghCommit の次に優先する */
  range?: string;
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

type HunkSource = Pick<HunkPlanInput, "commit" | "pr" | "ghCommit" | "range">;

export function hunkArgs({ commit, pr, ghCommit, range }: HunkSource) {
  if (pr) return ["gh", "pr", pr];
  if (ghCommit) return ["gh", "commit", ghCommit];
  if (range) return ["diff", range];
  return commit ? ["show", commit] : ["diff"];
}

/** hunk の起動時に `gh auth token` を GH_TOKEN に入れるシェルの断片（hunk の引数は $0 と $@ で渡す） */
const GH_TOKEN_LAUNCH = 't="$(gh auth token 2>/dev/null)"; [ -n "$t" ] && export GH_TOKEN="$t"; exec "$0" "$@"';

/**
 * GitHub のプルリクエスト・コミットを開く hunk の起動コマンド。非公開のリポジトリでも開けるよう、
 * 起動するシェルが `gh auth token` を GH_TOKEN の環境変数に入れてから hunk を起動する。
 * トークンはコマンドラインに現れないので、ps には出ない（tmux の -e で渡すと tmux のコマンドラインに載る）
 */
export function githubLaunch(hunkBin: string, args: string[]) {
  return ["sh", "-c", GH_TOKEN_LAUNCH, hunkBin, ...args];
}

/** --range に受け付ける形。`<ref>..<ref>` か `<ref>...<ref>`。ref は git の ref に使える文字だけで、`-` で始まらない（hunk のオプションと取り違えない） */
const RANGE_PATTERN = /^[\w@{}~^/][\w.@{}~^/-]*?\.\.\.?[\w@{}~^/][\w.@{}~^/-]*$/;

/**
 * `ws hunk` の --commit / --pr / --gh-commit / --range を確かめる。どれか 1 つだけ指定でき、
 * --pr は数字、--gh-commit は 7〜40 桁の 16 進数、--range は `<ref>...<ref>` の形（シェルや hunk の引数として安全な値）に限る
 */
export function parseHunkSource(flags: { commit?: string; pr?: string; ghCommit?: string; range?: string }): HunkSource {
  const given = [flags.commit, flags.pr, flags.ghCommit, flags.range].filter((v) => v !== undefined);
  if (given.length > 1) throw new Error("--commit、--pr、--gh-commit、--range は同時に指定できません");
  if (flags.pr !== undefined && !/^\d+$/.test(flags.pr)) throw new Error(`--pr にはプルリクエストの番号（数字）を指定してください: ${flags.pr}`);
  if (flags.ghCommit !== undefined && !/^[0-9a-fA-F]{7,40}$/.test(flags.ghCommit)) throw new Error(`--gh-commit にはコミットの sha（7〜40 桁の 16 進数）を指定してください: ${flags.ghCommit}`);
  if (flags.range !== undefined && !RANGE_PATTERN.test(flags.range)) throw new Error(`--range には <ref>...<ref> の形を指定してください: ${flags.range}`);
  return { commit: flags.commit, pr: flags.pr, ghCommit: flags.ghCommit, range: flags.range };
}

/**
 * ファイルの差分を hunk で開く計画。
 * - hunk のセッションがある: 中身を入れ替える（reload）。hunk ウィンドウがあればそこへ移る。無ければ（tmux の外や別の名前で開いている）移らない
 * - GitHub のプルリクエスト・コミット（pr / ghCommit）: reload せず、hunk ウィンドウがあれば respawn-pane -k で作り直し、無ければ作る。GH_TOKEN は githubLaunch が渡す
 * - セッションが無くウィンドウも無い: tmux セッション（無ければ作る）に hunk ウィンドウを作って起動する
 * - セッションが無いがウィンドウはある（hunk が終わっている、または起動中）: そのペインを respawn-pane -k で作り直す
 * 起動・入れ替えのあと、クライアントを hunk ウィンドウへ移し、最後に navigate でファイルへ移る（起動直後はセッションが現れるまで待つ）
 */
export function planHunk(input: HunkPlanInput): Step[] {
  const args = hunkArgs(input);
  const github = !!(input.pr || input.ghCommit);
  // GitHub のものは hunk session reload で入れ替えられないので、常にペインを作り直して起動し直す（起動を待って navigate する）
  const sessionLive = input.hunkSessionExists && !github;
  const navigate: Step[] = input.file ? [{ op: "hunkNavigate", cwd: input.cwd, file: input.file, wait: !sessionLive }] : [];
  const bring = bringClientTo(`${input.session.name}:${HUNK_WINDOW}`, input.ctx);
  const launch = github ? githubLaunch(input.hunkBin, args) : [input.hunkBin, ...args];
  if (sessionLive) {
    const reload: Step = { op: "hunkReload", cwd: input.cwd, hunkBin: input.hunkBin, args };
    return [reload, ...(input.windowExists ? bring : []), ...navigate];
  }
  if (input.windowExists) {
    return [{ op: "respawnHunkWindow", session: input.session.name, cwd: input.cwd, argv: launch }, ...bring, ...navigate];
  }
  return [...input.session.steps, { op: "openHunkWindow", session: input.session.name, cwd: input.cwd, argv: launch }, ...bring, ...navigate];
}
