/**
 * 通知: 人の注意が要る遷移（許可・質問待ち・エラーになった、完了して未確認になった）を知らせる（デスクトップ通知と tmux のメッセージ）
 */
import type { RootState } from "../../createStore.ts";
import * as git from "../../middlewares/git/git.ts";
import { selectAgents } from "../../modules/app/agents/selector.ts";
import { selectNotice } from "../../modules/app/attention/selector.ts";
import type { Notice, NoticeKind } from "../../types/attention.ts";
import { repoName } from "../../utils/repoName.ts";
import { type AppSubscriber, observe } from "../observe.ts";
import { notify } from "./notify.ts";

export interface NotifierOptions {
  kinds: NoticeKind[]; // 知らせる種類
  format: (n: Notice) => { title: string; body: string }; // 文面は表示側が決める
}

/** 知らせるときのリポジトリ名（worktree ならメインの名前） */
const repoOf = (cwd: string) => {
  const main = git.listWorktrees(cwd)[0]?.path;
  if (!main) return cwd;
  return repoName(main, git.ghqRoots());
};

/** 1つ前の状態から変わって、知らせるべきもの */
const noticesOf = (next: RootState, prev: RootState, kinds: NoticeKind[]): Notice[] =>
  selectAgents(next).flatMap((a) => {
    const n = selectNotice(prev, next, a.id);
    if (!n || !kinds.includes(n.kind)) return [];
    return [{ repo: repoOf(a.cwd), branch: git.currentBranch(a.cwd), ...n }];
  });

export const notifier =
  (o: NotifierOptions): AppSubscriber =>
  (store) =>
    void observe(
      store,
      (st) => st,
      (next, prev) => {
        for (const n of noticesOf(next, prev, o.kinds)) {
          const { title, body } = o.format(n);
          notify(title, body);
        }
      },
    );
