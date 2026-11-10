/**
 * mod の下に出す失敗の文（I/O なし）。mod は失敗を 2 つに分けて持つ。
 * - 読み直しの失敗（readError）: ws list・git の読み取りの結果。定期の読み直しのたびに入れ替わる（読めたら消える）
 * - 操作の失敗（actionError）: 行のクリックやボタンで呼んだ ws go・ws hunk・ws edit などの結果。読み直しでは消さず、次の操作まで残す
 * 1 つの値にまとめると、操作の失敗が直後の読み直しで消えて読めない。出すときは、ユーザーがいま行った操作の失敗を先にする
 */
export function shownError(readError: string, actionError: string) {
  return actionError || readError;
}
