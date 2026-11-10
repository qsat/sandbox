/** reduce の途中経過をすべて返す: [f(init, xs[0]), f(その結果, xs[1]), …] */
export function scan<T, A>(xs: readonly T[], f: (acc: A, x: T, i: number) => A, init: A): A[] {
  return xs.reduce<A[]>((sums, x, i) => sums.concat([f(sums.at(-1) ?? init, x, i)]), []);
}
