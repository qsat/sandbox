/**
 * 通知: 人の注意が要る遷移（許可・質問待ち・エラーになった、完了して未確認になった）を知らせる（デスクトップ通知と tmux のメッセージ）
 */
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

export const notifier =
  (o: NotifierOptions): AppSubscriber =>
  (store) =>
    void observe(
      store,
      (st) => st,
      (next, prev) => {
        for (const a of selectAgents(next)) {
          const n = selectNotice(prev, next, a.id);
          if (!n || !o.kinds.includes(n.kind)) continue;
          const main = git.listWorktrees(a.cwd)[0]?.path;
          const { title, body } = o.format({ repo: main ? repoName(main, git.ghqRoots()) : a.cwd, branch: git.currentBranch(a.cwd), ...n });
          notify(title, body);
        }
      },
    );
