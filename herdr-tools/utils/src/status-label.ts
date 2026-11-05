// blocked はアイコン（▲）で分かるので「blocked」の文字は出さず、理由だけを出す。理由が無ければ空（アイコンだけ）
export function statusLabel(a: { status: string; blockedReason?: string }) {
  return a.status === "blocked" ? (a.blockedReason ?? "") : a.status;
}
