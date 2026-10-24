import type { Notice } from "../../../types/notice.ts";
import * as git from "../../../infra/git.ts";
import { repoName } from "../../../utils/repoName.ts";
import { addAppListener, type AppListener } from "../../../createStore.ts";
import { isSessionAction } from "../sessions/slice.ts";
import { selectSession } from "../sessions/selector.ts";
import { noticeOf } from "./selector.ts";

/** 人の注意が要る遷移を知らせる（ログの流し直しでは知らせない。書いたプロセスが知らせ済み） */
export const notificationListeners = (onNotice: (n: Notice) => void): AppListener[] => [
  addAppListener({
    predicate: isSessionAction,
    effect: (action, api) => {
      if (!isSessionAction(action)) return;
      const id = action.payload.sessionId;
      const s = selectSession(api.getState(), id);
      const n = noticeOf(selectSession(api.getOriginalState(), id), s);
      if (!n || !s) return;
      const main = git.listWorktrees(s.cwd)[0]?.path;
      onNotice({ repo: main ? repoName(main, git.ghqRoots()) : s.cwd, branch: git.currentBranch(s.cwd), ...n });
    },
  }),
];
