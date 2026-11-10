/**
 * 通知: 人の注意が要る遷移（許可・質問待ち・エラーになった、完了して未確認になった）を知らせる（デスクトップ通知と tmux のメッセージ）
 * 出来事の連鎖が終わってから比べる。表示中のペインで完了したときは、連鎖の中で確認済みになるので知らせない
 */
import { selectAgents } from "../../redux/modules/app/agents/selector.ts";
import { selectNotice } from "../../redux/modules/app/attention/selector.ts";
import type { RootState } from "../../redux/rootReducer.ts";
import type { Notice, NoticeKind } from "../../redux/types/attention.ts";
import { notification } from "../notification.ts";
import { type NotifyOptions, notify } from "./notify.ts";
import { type AppSubscriber, observe } from "./observe.ts";

export interface NotifierOptions extends NotifyOptions {
  kinds: NoticeKind[]; // 知らせる種類
  locate: (cwd: string) => { repo: string; branch?: string }; // エージェントの居場所 → リポジトリ名とブランチ（組み立てる側が調べ方を渡す）
}

/** 1つ前の状態から変わって、知らせるべきもの */
const noticesOf = (next: RootState, prev: RootState, o: NotifierOptions): Notice[] =>
  selectAgents(next).flatMap((a) => {
    const n = selectNotice(prev, next, a.id);
    if (!n || !o.kinds.includes(n.kind)) return [];
    return [{ ...o.locate(a.cwd), ...n }];
  });

export const notifier =
  (o: NotifierOptions): AppSubscriber =>
  (store) =>
    void observe(
      store,
      (st) => st,
      (next, prev) => {
        for (const n of noticesOf(next, prev, o)) {
          const { title, body } = notification(n);
          notify(title, body, o);
        }
      },
      { settle: true },
    );
