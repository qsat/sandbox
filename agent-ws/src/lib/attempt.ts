/** f の結果。例外が出たら otherwise（ファイルが無い・読めない・壊れているなど、失敗してよいときに使う） */
export function attempt<T>(f: () => T, otherwise: T): T {
  try {
    return f();
  } catch {
    return otherwise;
  }
}
