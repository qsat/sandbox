/**
 * 購読者: 状態を人に見せる（ステータスライン・通知）。store.subscribe の上で、見ている部分が変わったときだけ動く
 *
 * middleware が「出来事に反応して外界とやりとりし、結果を出来事として戻す」のに対し、購読者は状態を映すだけで何も dispatch しない。
 * 何を映すかは状態だけで決まるので、どの出来事で変わったかは見ない。entry がログから状態を組み立て終えた後に購読させる
 */
import { debounce } from "../../lib/debounce.ts";
import type { AppStore, RootState } from "../createStore.ts";

export type AppSubscriber = (store: AppStore) => void;

export interface ObserveOptions {
  /**
   * 変化が落ち着いてから比べる（続けて変わっても1回にまとめる）。1つの出来事から middleware が出す出来事の連鎖は
   * 同期的に進むので、待ち時間 0 でまとめれば連鎖の途中の状態（完了して、見ているので確認済みになる間の ✓ など）を見ない
   */
  settle?: boolean;
}

/** select した値が変わったら onChange を呼ぶ（購読した時点の値は基準にするだけで、呼ばない） */
export function observe<T>(
  store: AppStore,
  select: (st: RootState) => T,
  onChange: (next: T, prev: T) => void,
  o: ObserveOptions = {},
): () => void {
  // biome-ignore lint/plugin/no-let: 前回の値と比べるには、通知をまたいで持つしかない
  let prev = select(store.getState());
  const check = () => {
    const next = select(store.getState());
    if (Object.is(next, prev)) return;
    const before = prev;
    prev = next;
    onChange(next, before);
  };
  const checkSoon = debounce(check, 0);
  return store.subscribe(() => {
    if (o.settle) return checkSoon();
    check();
  });
}
