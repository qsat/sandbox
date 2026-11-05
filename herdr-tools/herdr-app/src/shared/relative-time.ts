/** 日時（unix 秒）を、今からの相対的な言い方にする。commit-history と pull-requests で共通 */
export function relativeTime(nowSec: number, thenSec: number): string {
  const d = Math.max(0, nowSec - thenSec);
  if (d < 60) return "たった今";
  if (d < 3600) return `${Math.floor(d / 60)} 分前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 時間前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 日前`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))} か月前`;
  return `${Math.floor(d / (86400 * 365))} 年前`;
}
