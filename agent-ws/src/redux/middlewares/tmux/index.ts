/**
 * tmux middleware: 人がどこを見ているか・どこへ行くか（tmux のペイン）
 *
 * - destinationChosen: 人が選んだ行き先のペインへ移動する（無ければ新しいウィンドウ）。結果は visited
 * - paneFocused: そのペインにいるエージェントの完了を確認したことにする
 * - turnFinished: いま表示しているペインで完了したなら、もう見ている
 *
 * ステータスラインの描き直しは、状態を映すだけなので middleware ではなく購読者（subscribers/statusLine）が行う
 */
import type { AppMiddleware } from "../../createStore.ts";
import { selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { turnFinished } from "../../modules/app/agents/slice.ts";
import { selectUnseen } from "../../modules/app/attention/selector.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { destinationChosen, paneFocused, visited } from "../../modules/ui/visit/slice.ts";
import type { Pid } from "../../types/agent.ts";
import type { Pane, VisitResult, VisitTarget } from "../../types/visit.ts";
import { ancestry } from "../../utils/ancestry.ts";
import { findPane } from "../../utils/findPane.ts";
import { isReplayed } from "../../utils/replayed.ts";
import { type AppApi, effects, on } from "../effects.ts";
import { psTable } from "../processes/proc.ts";
import { realPath } from "../shared/shell.ts";
import * as cli from "./tmux.ts";

const parentOf = () => {
  const ppid = new Map(psTable().map((p) => [p.pid, p.ppid]));
  return (pid: Pid) => ppid.get(pid);
};

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

export const tmux = (): AppMiddleware =>
  effects((api) => {
    return [
      on(destinationChosen, ({ payload: p }) => api.dispatch(visited(visit(api, p.target, p.create, p.dryRun ?? false)))),
      on(paneFocused, ({ payload: { panePid, at } }) => {
        const st = api.getState();
        const unseen = selectAgents(st).filter((a) => a.pid && selectUnseen(st, a.id));
        if (!unseen.length) return; // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
        const up = parentOf();
        for (const a of unseen) {
          if ([...ancestry(a.pid, up)].includes(panePid)) api.dispatch(acknowledged({ agentId: a.id, at }));
        }
      }),
      on(turnFinished, (action) => {
        if (isReplayed(action)) return;
        const { agentId, at } = action.payload;
        const a = selectAgent(api.getState(), agentId);
        if (!a?.pid || !selectUnseen(api.getState(), agentId)) return;
        const pane = findPane({ title: "", name: "", pid: a.pid }, cli.listPanes(), parentOf());
        if (pane?.active) api.dispatch(acknowledged({ agentId, at }));
      }),
    ];
  });
