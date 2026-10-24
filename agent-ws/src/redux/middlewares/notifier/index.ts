/**
 * notifier middleware: 人の注意が要る遷移を知らせる（デスクトップ通知と tmux のメッセージ）
 * 流し直した出来事では知らせない（書いたプロセスが知らせ済み）
 */
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgent } from "../../modules/app/agents/selector.ts";
import { isAgentEvent } from "../../modules/app/agents/slice.ts";
import { selectNotice } from "../../modules/app/attention/selector.ts";
import type { Notice, NoticeKind } from "../../types/attention.ts";
import { isReplayed } from "../../utils/replayed.ts";
import { repoName } from "../../utils/repoName.ts";
import * as git from "../system/git.ts";
import { notify } from "./notify.ts";

export interface NotifierOptions {
  kinds: NoticeKind[]; // 知らせる種類
  format: (n: Notice) => { title: string; body: string }; // 文面は表示側が決める
}

export const notifier =
  (o: NotifierOptions): AppMiddleware =>
  (api) =>
  (next) =>
  (action) => {
    if (!isAgentEvent(action) || isReplayed(action)) return next(action);
    const before = api.getState();
    const result = next(action);
    const id = action.payload.agentId;
    const n = selectNotice(before, api.getState(), id);
    const a = selectAgent(api.getState(), id);
    if (n && a && o.kinds.includes(n.kind)) {
      const main = git.listWorktrees(a.cwd)[0]?.path;
      const { title, body } = o.format({ repo: main ? repoName(main, git.ghqRoots()) : a.cwd, branch: git.currentBranch(a.cwd), ...n });
      notify(title, body);
    }
    return result;
  };
