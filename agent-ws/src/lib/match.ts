/**
 * kind で場合分けする（switch の代わり）。すべての kind を書かないと型エラーになる
 *
 *   match(result, {
 *     focused: (r) => …,   // r は kind が "focused" のものに絞られる
 *     failed: (r) => …,
 *   })
 */
type Cases<T extends { kind: string }, R> = { [K in T["kind"]]: (value: T & { kind: K }) => R };

export const match = <T extends { kind: string }, R>(value: T, cases: Cases<T, R>): R =>
  (cases[value.kind as T["kind"]] as (value: T) => R)(value);
