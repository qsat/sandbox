/**
 * middleware を「出来事 → 反応」の対応表として書く
 *
 *   export const claude = (): AppMiddleware =>
 *     effects((api) => [
 *       on(hookReceived, ({ payload }) => …),
 *       on([initialized, ticked], ({ payload }) => …),
 *     ]);
 *
 * - 反応は reducer の後に呼ばれる（状態はもう変わっている）。変わる前の状態は2つ目の引数で受け取る
 * - 当てはまる反応は上から順にすべて呼ぶ（最初の1つで止めない）。どの出来事にも反応するなら always
 * - 当てはめる型は action creator（createSlice の actions・createAction）か、isAnyOf などの型ガード。反応の引数はその型に絞られる
 */
import { type ActionMatchingAnyOf, isAnyOf, type MiddlewareAPI, type UnknownAction } from "@reduxjs/toolkit";
import type { AppDispatch, AppMiddleware, RootState } from "../createStore.ts";

type Matcher = Parameters<typeof isAnyOf>[number];
export type AppApi = MiddlewareAPI<AppDispatch, RootState>;
type React<A> = (action: A, prev: RootState) => void;

/** 1つの出来事に対する反応（当てはまらなければ何もしない） */
export type Reaction = (action: unknown, prev: RootState) => void;

/** この出来事（どれか）が起きたら反応する */
export function on<M extends Matcher>(matcher: M, react: React<ActionMatchingAnyOf<[M]>>): Reaction;
export function on<M extends Matcher[]>(matchers: [...M], react: React<ActionMatchingAnyOf<M>>): Reaction;
export function on(matchers: Matcher | Matcher[], react: React<never>): Reaction {
  const match = isAnyOf(...[matchers].flat());
  return (action, prev) => {
    if (match(action)) react(action as never, prev);
  };
}

/** どの出来事にも反応する（状態の変化を見て判断するとき） */
export const always =
  (react: React<UnknownAction>): Reaction =>
  (action, prev) =>
    react(action as UnknownAction, prev);

/** 反応の並びから middleware を作る。setup は Store ごとに1回呼ばれる（middleware ごとの状態はその中に持つ） */
export const effects =
  (setup: (api: AppApi) => Reaction[]): AppMiddleware =>
  (api) => {
    const reactions = setup(api);
    return (next) => (action) => {
      const prev = api.getState();
      const result = next(action);
      for (const react of reactions) react(action, prev);
      return result;
    };
  };
