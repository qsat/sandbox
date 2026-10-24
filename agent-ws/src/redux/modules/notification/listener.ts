import type { Notice } from "../../../domain/model.ts";
import * as git from "../../../infra/git.ts";
import { repoName } from "../../../domain/model.ts";
import { addAppListener, type AppListener } from "../../createStore.ts";
import { isSessionAction } from "../sessions/slice.ts";
import { noticeOf } from "./selector.ts";

/** 人の注意が要る遷移を知らせる（ログの流し直しでは知らせない。書いたプロセスが知らせ済み） */
export const notificationListeners = (onNotice: (n: Notice) => void): AppListener[] => [
  addAppListener({
    predicate: isSessionAction,
    effect: (action, api) => {
      if (!isSessionAction(action)) return;
      const id = action.payload.sessionId;
      const s = api.getState().sessions[id];
      const n = noticeOf(api.getOriginalState().sessions[id], s);
      if (!n || !s) return;
      const main = git.listWorktrees(s.cwd)[0]?.path;
      onNotice({ repo: main ? repoName(main, git.ghqRoots()) : s.cwd, branch: git.currentBranch(s.cwd), ...n });
    },
  }),
];
