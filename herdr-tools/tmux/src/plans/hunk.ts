import { bringClientTo, type GoContext, type Step } from "./go";

export const HUNK_WINDOW = "hunk";

/** hunk で開くもの */
export type HunkSource =
  | { kind: "worktree" }
  | { kind: "commit"; rev: string }
  | { kind: "range"; range: string }
  | { kind: "against"; rev: string }
  | { kind: "gh-pr"; number: string }
  | { kind: "gh-commit"; sha: string };

export interface HunkPlanInput {
  /** hunk の作業ディレクトリ（worktree のパス） */
  cwd: string;
  hunkBin: string;
  source: HunkSource;
  /** 開いたあとに移るファイル（worktree からの相対パス） */
  file?: string;
  /** その worktree の tmux セッション（無ければ作る steps を持つ） */
  session: { name: string; steps: Step[] };
  windowExists: boolean;
  /** `hunk session get --repo <cwd>` が成功するか */
  hunkSessionExists: boolean;
  ctx: GoContext;
}

export function hunkArgs(source: HunkSource) {
  switch (source.kind) {
    case "worktree":
      return ["diff"];
    case "commit":
      return ["show", source.rev];
    case "range":
      return ["diff", source.range];
    case "against":
      return ["diff", source.rev];
    case "gh-pr":
      return ["gh", "pr", source.number];
    case "gh-commit":
      return ["gh", "commit", source.sha];
  }
}

/** `hunk session reload` は diff と show しか入れ替えられない */
function fromGithub(source: HunkSource) {
  return source.kind === "gh-pr" || source.kind === "gh-commit";
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

const RANGE_PATTERN = /^[\w@{}~^/][\w.@{}~^/-]*?\.\.\.?[\w@{}~^/][\w.@{}~^/-]*$/;
const REVISION_PATTERN = /^[\w@{}~^/][\w.@{}~^/-]*$/;

/**
 * `ws hunk` の --commit / --pr / --gh-commit / --range / --against を読む。どれか 1 つだけ指定でき、無ければ未コミットの変更。
 * 値は hunk・git の引数とシェルに渡しても安全な形に限る（- で始まらない。--pr は数字、--gh-commit は 16 進数）
 */
export function parseHunkSource(flags: { commit?: string; pr?: string; ghCommit?: string; range?: string; against?: string }): HunkSource {
  const given = Object.values(flags).filter((v) => v !== undefined);
  if (given.length > 1) throw new Error("--commit、--pr、--gh-commit、--range、--against は同時に指定できません");
  const { commit, pr, ghCommit, range, against } = flags;
  if (pr !== undefined) {
    if (!/^\d+$/.test(pr)) throw new Error(`--pr にはプルリクエストの番号（数字）を指定してください: ${pr}`);
    return { kind: "gh-pr", number: pr };
  }
  if (ghCommit !== undefined) {
    if (!/^[0-9a-fA-F]{7,40}$/.test(ghCommit)) throw new Error(`--gh-commit にはコミットの sha（7〜40 桁の 16 進数）を指定してください: ${ghCommit}`);
    return { kind: "gh-commit", sha: ghCommit };
  }
  if (range !== undefined) {
    if (!RANGE_PATTERN.test(range)) throw new Error(`--range には <ref>...<ref> の形を指定してください: ${range}`);
    return { kind: "range", range };
  }
  if (against !== undefined) {
    if (!REVISION_PATTERN.test(against) || against.includes("..")) throw new Error(`--against には 1 つのリビジョン（ハッシュやブランチ名）を指定してください: ${against}`);
    return { kind: "against", rev: against };
  }
  if (commit === undefined) return { kind: "worktree" };
  if (!REVISION_PATTERN.test(commit)) throw new Error(`--commit には 1 つのリビジョン（ハッシュやブランチ名）を指定してください: ${commit}`);
  return { kind: "commit", rev: commit };
}

/**
 * ファイルの差分を hunk で開く計画。
 * - hunk のセッションがある: 中身を入れ替える（reload）。hunk ウィンドウがあればそこへ移る。無ければ（tmux の外や別の名前で開いている）移らない
 * - GitHub のプルリクエスト・コミット（gh-pr / gh-commit）: reload せず、hunk ウィンドウがあれば respawn-pane -k で作り直し、無ければ作る。GH_TOKEN は githubLaunch が渡す
 * - セッションが無くウィンドウも無い: tmux セッション（無ければ作る）に hunk ウィンドウを作って起動する
 * - セッションが無いがウィンドウはある（hunk が終わっている、または起動中）: そのペインを respawn-pane -k で作り直す
 * 起動・入れ替えのあと、クライアントを hunk ウィンドウへ移し、最後に navigate でファイルへ移る（起動直後はセッションが現れるまで待つ）
 */
export function planHunk(input: HunkPlanInput): Step[] {
  const args = hunkArgs(input.source);
  const github = fromGithub(input.source);
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
