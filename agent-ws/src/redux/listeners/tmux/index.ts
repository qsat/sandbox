/**
 * tmux: 人がどこを見ているか・どこへ行くか（tmux のペイン。listener）
 *
 * - destinationChosen: 人が選んだ行き先のペインへ移動する（無ければ新しいウィンドウ）。結果は visited
 * - paneFocused: そのペインにいるエージェントの完了を確認したことにする
 * - turnFinished: いま表示しているペインで完了したなら、もう見ている
 *
 * ステータスラインの描き直しは、状態を映すだけなので listener ではなく購読者（ui/subscribers/statusLine）が行う
 */

import { isAllOf } from "@reduxjs/toolkit";
import { realPath } from "../../../lib/run.ts";
import type { AppApi, AppListener } from "../../createStore.ts";
import { selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { turnFinished } from "../../modules/app/agents/slice.ts";
import { selectUnseen } from "../../modules/app/attention/selector.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { destinationChosen, paneFocused, visited } from "../../modules/ui/visit/slice.ts";
import type { RootState } from "../../rootReducer.ts";
import type { Pane, VisitResult, VisitTarget } from "../../types/visit.ts";
import { ancestry } from "../../utils/ancestry.ts";
import { findPane } from "../../utils/findPane.ts";
import { isFresh } from "../../utils/replayed.ts";
import { processTree } from "../processes/proc.ts";
import * as cli from "./tmux.ts";

const parentOf = () => processTree().parentOf;

/** パスは実体で探す（シンボリックリンク越しに開いたペインも見つける） */
const resolved = (t: VisitTarget): VisitTarget => {
  if (!t.path) return t;
  return { ...t, path: realPath(t.path) };
};

/** 見つけたペインへ移る（dryRun なら探すだけ） */
function goTo(api: AppApi, pane: Pane, t: VisitTarget, dryRun: boolean): VisitResult {
  if (dryRun) return { kind: "found", pane };
  if (!cli.focusPane(pane.id)) return { kind: "failed", title: t.title };
  api.dispatch(paneFocused({ panePid: pane.pid, at: api.getState().app.lifecycle.now }));
  return { kind: "focused", pane };
}

/** ペインが無ければ新しいウィンドウを開いて移る */
function openWindow(path: string, t: VisitTarget): VisitResult {
  const id = cli.newWindow(path, t.name);
  if (!id || !cli.focusPane(id)) return { kind: "failed", title: t.title };
  return { kind: "created", path };
}

function visit(api: AppApi, target: VisitTarget, create: boolean, dryRun: boolean): VisitResult {
  const t = resolved(target);
  const pane = findPane(t, cli.listPanes(), parentOf());
  if (pane) return goTo(api, pane, t, dryRun);
  if (!create || !t.path || dryRun) return { kind: "notFound", title: t.title };
  return openWindow(t.path, t);
}

/** 未確認で、pid が分かっているエージェント */
const unseenAgents = (st: RootState) => selectAgents(st).filter((a) => a.pid && selectUnseen(st, a.id));

/** このプロセスで起きた完了（読み直した完了は、書いたプロセスが確かめ済み） */
const isFreshFinish = isAllOf(turnFinished, isFresh);

export const tmux = (): AppListener[] => [
  (start) =>
    start({
      actionCreator: destinationChosen,
      effect: ({ payload: p }, api) => void api.dispatch(visited(visit(api, p.target, p.create, p.dryRun ?? false))),
    }),
  // フォーカスのたびに届くので、未確認のエージェントがいるときだけ動く（いなければ ps もしない）
  (start) =>
    start({
      predicate: (action, current): action is ReturnType<typeof paneFocused> =>
        paneFocused.match(action) && unseenAgents(current).length > 0,
      effect: ({ payload: { panePid, at } }, api) => {
        const up = parentOf();
        const inPane = unseenAgents(api.getState()).filter((a) => ancestry(a.pid, up).some((pid) => pid === panePid));
        for (const a of inPane) api.dispatch(acknowledged({ agentId: a.id, at }));
      },
    }),
  // 完了して未確認になったエージェントのペインが、いま表示中なら、もう見ている
  (start) =>
    start({
      predicate: (action, current): action is ReturnType<typeof turnFinished> =>
        isFreshFinish(action) && unseenAgents(current).some((a) => a.id === action.payload.agentId),
      effect: ({ payload: { agentId, at } }, api) => {
        const pid = selectAgent(api.getState(), agentId)?.pid ?? undefined;
        const pane = findPane({ title: "", name: "", pid }, cli.listPanes(), parentOf());
        if (pane?.active) api.dispatch(acknowledged({ agentId, at }));
      },
    }),
];
