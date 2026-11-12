/**
 * worktree を作る（ws create）・消す（ws destroy）ときの判断と文面（I/O なし）。
 * 置き場所とブランチ名の規則は ws pr と同じもの（domain/pr-worktree.ts の prWorktreePath・isSafeBranchName）を使う
 */

/** 新しいブランチをどこから分けるか */
export type CreateBase =
  /** 手元にそのブランチがあるので、そのまま checkout する */
  | { kind: "existing-branch" }
  /** origin に同じ名前のブランチがあるので、それを追跡して作る */
  | { kind: "track-remote"; remote: string }
  /** 指定されたリビジョンから新しく分ける */
  | { kind: "from"; rev: string }
  /** 呼んだ worktree の HEAD から新しく分ける */
  | { kind: "head" };

/**
 * 手元にブランチがあればそれを使う（--from とは両立しない）。無ければ --from、origin の同じ名前のブランチ、HEAD の順で分ける元を決める。
 * origin に同じ名前のブランチがあるのに HEAD から分けると、push のときに食い違うので、origin のブランチを追跡する
 */
export function createBase(input: { branch: string; localBranchExists: boolean; remoteBranchExists: boolean; from?: string }): CreateBase {
  if (input.localBranchExists) {
    if (input.from) throw new Error(`ブランチ ${input.branch} は既にあるので、--from は指定できません`);
    return { kind: "existing-branch" };
  }
  if (input.from) {
    if (input.from.startsWith("-")) throw new Error(`扱えないリビジョンです: ${input.from}`);
    return { kind: "from", rev: input.from };
  }
  return input.remoteBranchExists ? { kind: "track-remote", remote: `origin/${input.branch}` } : { kind: "head" };
}

export interface CreatedWorktree {
  path: string;
  branch: string;
  base: CreateBase;
}

export function worktreeCreatedMessage(c: CreatedWorktree) {
  const from = { "existing-branch": "既にあるブランチ", "track-remote": "origin のブランチを追跡", from: c.base.kind === "from" ? `${c.base.rev} から分けた` : "", head: "HEAD から分けた" }[c.base.kind];
  return `worktree を作りました（${c.branch}。${from}）: ${c.path}`;
}

/** 消す前に調べた worktree の状態 */
export interface RemovalTarget {
  /** worktree の場所（git の toplevel） */
  path: string;
  /** 本体のリポジトリの場所 */
  main: string;
  isMain: boolean;
  /** checkout しているブランチ（detached HEAD なら null） */
  branch: string | null;
  /** 未コミットの変更と追跡されていないファイル（git status --porcelain の行） */
  changes: string[];
  hasSubmodules: boolean;
}

/**
 * 消すのを断る理由。断らないなら null。
 * 本体の worktree と、呼び出したエージェント自身がいる worktree は --force でも消さない。
 * 未コミットの変更・追跡されていないファイルは、消すと戻せないので --force を求める。
 * submodule を持つ worktree は、git が --force なしでは消さないので、エージェントを止める前に断る
 */
export function destroyRefusal(input: { target: RemovalTarget; force: boolean; callerIsAgentHere: boolean }): string | null {
  const { target } = input;
  if (target.isMain) return `本体の worktree は消せません: ${target.path}`;
  if (input.callerIsAgentHere) return `この worktree で動いているエージェント自身からは消せません: ${target.path}`;
  if (input.force) return null;
  if (target.changes.length > 0) {
    const shown = target.changes.slice(0, 10).join("\n");
    const more = target.changes.length > 10 ? `\n…ほか ${target.changes.length - 10} 個` : "";
    return `未コミットの変更か追跡されていないファイルが ${target.changes.length} 個あるので消しません（消すなら --force）: ${target.path}\n${shown}${more}`;
  }
  if (target.hasSubmodules) return `submodule があるので、git は --force なしでは消せません（消すなら --force）: ${target.path}`;
  return null;
}

/** ブランチを消した結果。kept は、マージされていないなどで git branch -d が断ったとき */
export type BranchRemoval = { kind: "deleted"; branch: string } | { kind: "kept"; branch: string; reason: string } | { kind: "none" };

export function branchRemovalMessage(r: BranchRemoval) {
  switch (r.kind) {
    case "deleted":
      return `ブランチを消しました: ${r.branch}`;
    case "kept":
      return `ブランチは残しました（${r.branch}）: ${r.reason}`;
    case "none":
      return "ブランチはありません（detached HEAD）";
  }
}
