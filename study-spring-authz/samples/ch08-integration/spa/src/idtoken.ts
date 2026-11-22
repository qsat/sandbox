import { base64url } from "./pkce";

export type Claims = Record<string, unknown>;

function decodeBase64url(part: string): Uint8Array {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function decodeJwt(jwt: string): { header: Claims; claims: Claims; signingInput: string; signature: Uint8Array } {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("JWT の形式ではありません");
  const [h, p, s] = parts as [string, string, string];
  const json = (part: string) => JSON.parse(new TextDecoder().decode(decodeBase64url(part))) as Claims;
  return { header: json(h), claims: json(p), signingInput: `${h}.${p}`, signature: decodeBase64url(s) };
}

export interface Expected {
  issuer: string;
  clientId: string;
  nonce: string;
  /** 現在時刻 (秒)。テストで差し替えられるようにしている */
  now?: number;
  /** 時計のずれの許容 (秒) */
  skew?: number;
}

/**
 * ID トークンの中身の検証 (OpenID Connect Core 1.0 §3.1.3.7)。
 *  - iss が IdP の issuer と完全一致
 *  - aud に自分の client_id が含まれる (複数なら azp が自分)
 *  - nonce が認可リクエストで送った値と一致 (リプレイ対策。トークンを自分のリクエストに結びつける)
 *  - exp が過ぎていない
 * 問題があれば Error を投げる。
 */
export function validateIdTokenClaims(claims: Claims, expected: Expected): void {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const skew = expected.skew ?? 60;
  if (claims.iss !== expected.issuer) throw new Error(`iss が違います: ${String(claims.iss)}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new Error(`aud に ${expected.clientId} が含まれません`);
  if (aud.length > 1 && claims.azp !== expected.clientId) throw new Error("azp が自分の client_id ではありません");
  if (claims.nonce !== expected.nonce) throw new Error("nonce が一致しません");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new Error("ID トークンの期限が切れています");
}

/**
 * 署名の検証 (RS256)。IdP の jwks (公開鍵) を取得し、kid が合う鍵で検証する。
 *
 * OIDC Core §3.1.3.7 は、ID トークンをトークンエンドポイントから TLS 経由で直接受け取った場合は
 * 署名検証を省略してよいとしている (サーバーの身元を TLS が保証するため)。
 * この教材は http で動かしているので、省略せずに検証する。本番で https を使い、トークンを
 * トークンエンドポイントから直接受け取るだけなら、省略も仕様上は許される。
 */
export async function verifySignature(idToken: string, jwksUri: string): Promise<void> {
  const { header, signingInput, signature } = decodeJwt(idToken);
  if (header.alg !== "RS256") throw new Error(`未対応のアルゴリズムです: ${String(header.alg)}`);
  const jwks = (await (await fetch(jwksUri)).json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`kid=${String(header.kid)} の鍵が jwks にありません`);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(signingInput));
  if (!ok) throw new Error("ID トークンの署名が正しくありません");
}

export { base64url };
