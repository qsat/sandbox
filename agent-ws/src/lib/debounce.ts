/**
 * 呼ばれるたびに待ち直し、呼び出しが ms 途絶えたら1回だけ実行する（最後の呼び出しの引数で）
 * 続けて届く出来事（ログへの追記・エージェントの増減・画面の変化）を、1回の取り込みや描画にまとめるのに使う
 */
export function debounce<A extends unknown[]>(run: (...args: A) => void, ms: number): (...args: A) => void {
  // biome-ignore lint/plugin/no-let: 待っているタイマーは、呼び出しをまたいで持つしかない
  let timer: Timer | undefined;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => run(...args), ms);
  };
}
