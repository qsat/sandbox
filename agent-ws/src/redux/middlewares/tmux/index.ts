/**
 * tmux middleware: 人がどこを見ているか・どこへ行くか（tmux のペイン）
 *
 * - destinationChosen: 人が選んだ行き先のペインへ移動する（無ければ新しいウィンドウ）。結果は visited
 * - paneFocused: そのペインにいるエージェントの完了を確認したことにする
 * - turnFinished: いま表示しているペインで完了したなら、もう見ている
 * - ステータスラインの印が変わったら、status-interval を待たずに描き直す
 */
import type { AppMiddleware, RootState } from "../../createStore.ts";
import { selectAgent, selectAgents } from "../../modules/app/agents/selector.ts";
import { turnFinished } from "../../modules/app/agents/slice.ts";
import { selectStatusFlags, selectUnseen } from "../../modules/app/attention/selector.ts";
import { acknowledged } from "../../modules/app/attention/slice.ts";
import { destinationChosen, paneFocused, visited } from "../../modules/ui/visit/slice.ts";
import type { Pid } from "../../types/agent.ts";
import type { VisitResult, VisitTarget } from "../../types/visit.ts";
import { ancestry } from "../../utils/ancestry.ts";
import { findPane } from "../../utils/findPane.ts";
import { isReplayed } from "../../utils/replayed.ts";
import { psTable } from "../processes/proc.ts";
import { realPath } from "../shared/shell.ts";
import * as cli from "./tmux.ts";

const parentOf = () => {
  const ppid = new Map(psTable().map((p) => [p.pid, p.ppid]));
  return (pid: Pid) => ppid.get(pid);
};

const flags = (st: RootState) => JSON.stringify(selectStatusFlags(st));

export const tmux = (): AppMiddleware => (api) => {
  const visit = (target: VisitTarget, create: boolean, dryRun: boolean): VisitResult => {
    const t = target.path ? { ...target, path: realPath(target.path) } : target;
    const pane = findPane(t, cli.listPanes(), parentOf());
    if (pane && dryRun) return { kind: "found", pane };
    if (pane) {
      if (!cli.focusPane(pane.id)) return { kind: "failed", title: t.title };
      api.dispatch(paneFocused({ panePid: pane.pid, at: api.getState().app.lifecycle.now }));
      return { kind: "focused", pane };
    }
    if (!create || !t.path || dryRun) return { kind: "notFound", title: t.title };
    const id = cli.newWindow(t.path, t.name);
    return id && cli.focusPane(id) ? { kind: "created", path: t.path } : { kind: "failed", title: t.title };
  };

  return (next) => (action) => {
    const before = api.getState();
    const result = next(action);
    if (destinationChosen.match(action)) {
      const p = action.payload;
      api.dispatch(visited(visit(p.target, p.create, p.dryRun ?? false)));
    } else if (paneFocused.match(action)) {
      const st = api.getState();
      const unseen = selectAgents(st).filter((a) => a.pid && selectUnseen(st, a.id));
      if (unseen.length) {
        // フォーカスのたびに呼ばれるので、未確認が無ければ ps もしない
        const up = parentOf();
        for (const a of unseen) {
          if ([...ancestry(a.pid, up)].includes(action.payload.panePid))
            api.dispatch(acknowledged({ agentId: a.id, at: action.payload.at }));
        }
      }
    } else if (turnFinished.match(action) && !isReplayed(action)) {
      const { agentId, at } = action.payload;
      const a = selectAgent(api.getState(), agentId);
      if (a?.pid && selectUnseen(api.getState(), agentId)) {
        const pane = findPane({ title: "", name: "", pid: a.pid }, cli.listPanes(), parentOf());
        if (pane?.active) api.dispatch(acknowledged({ agentId, at }));
      }
    }
    if (!isReplayed(action) && flags(before) !== flags(api.getState())) cli.refreshStatus();
    return result;
  };
};
