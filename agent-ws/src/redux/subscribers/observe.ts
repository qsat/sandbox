/**
 * 購読者: 状態を人に見せる（ステータスライン・通知）。store.subscribe の上で、見ている部分が変わったときだけ動く
 *
 * middleware が「出来事に反応して外界とやりとりし、結果を出来事として戻す」のに対し、購読者は状態を映すだけで何も dispatch しない。
 * 何を映すかは状態だけで決まるので、どの出来事で変わったかは見ない。entry がログから状態を組み立て終えた後に購読させる
 */
import type { AppStore, RootState } from "../createStore.ts";

export type AppSubscriber = (store: AppStore) => void;

/** select した値が変わったら onChange を呼ぶ（購読した時点の値は基準にするだけで、呼ばない） */
export function observe<T>(
  store: AppStore,
  select: (st: RootState) => T,
  onChange: (next: T, prev: T) => void,
  equal: (a: T, b: T) => boolean = Object.is,
): () => void {
  // biome-ignore lint/plugin/no-let: 前回の値と比べるには、通知をまたいで持つしかない
  let prev = select(store.getState());
  return store.subscribe(() => {
    const next = select(store.getState());
    if (equal(next, prev)) return;
    const before = prev;
    prev = next;
    onChange(next, before);
  });
}
