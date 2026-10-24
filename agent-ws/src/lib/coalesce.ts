/**
 * 何度呼ばれても、待ち時間の後に1回だけ実行する（実行されるまでの呼び出しはまとめる）
 * 続けて届く出来事（ログへの追記・エージェントの増減・画面の変化）を、1回の取り込みや描画にまとめるのに使う
 */
export function coalesce(run: () => void): (delayMs: number) => void {
  // biome-ignore lint/plugin/no-let: 実行を予約済みかどうかは、呼び出しをまたいで持つしかない
  let queued = false;
  return (delayMs) => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      run();
    }, delayMs);
  };
}
