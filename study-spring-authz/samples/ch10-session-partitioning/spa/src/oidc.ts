import { config } from "./config";
import { type Claims, decodeJwt, validateIdTokenClaims, verifySignature } from "./idtoken";
import { createPkce, randomString } from "./pkce";

/**
 * 認可コード + PKCE のクライアント実装。OAuth ライブラリは使わず、仕組みが読めるように書く。
 *
 * 何をどこに置くか:
 *  - code_verifier / state / nonce: sessionStorage。認可リクエストを送ってから、IdP から戻ってくるまで
 *    (ページ遷移をまたいで) 覚えておく必要がある。タブごとに独立し、タブを閉じると消える。
 *    localStorage だと別タブにも残るので使わない。なお、同じオリジンで動く JavaScript (XSS を含む) からは
 *    どちらも読める。code_verifier は 1 回限りの値なので、使い終わったらすぐ消す。
 *  - アクセストークン / ID トークン: メモリ (このモジュールの変数) だけ。ストレージに置くと、XSS で
 *    読み出されたあと長く使われる。メモリならリロードで消えるが、IdP のセッションが残っていれば
 *    画面遷移だけでログインし直せる (SSO) ので、困らない。
 */

const PENDING_KEY = "oidc.pending";

interface Pending {
  state: string;
  verifier: string;
  nonce: string;
  /** ログイン後に続けて実行する操作 (期限切れで再ログインしたときに、操作を覚えておく) */
  next?: string;
}

export interface Session {
  accessToken: string;
  /** アクセストークンの期限 (エポックミリ秒)。expires_in は秒 */
  expiresAt: number;
  scope: string;
  idTokenClaims: Claims;
}

let session: Session | null = null;

export function getSession(): Session | null {
  return session;
}

export function clearSession(): void {
  session = null;
}

export function isExpired(s: Session, marginMs = 5_000): boolean {
  return Date.now() + marginMs >= s.expiresAt;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

let discoveryCache: Discovery | null = null;

/** ディスカバリ (OpenID Connect Discovery 1.0)。エンドポイントの URL を決め打ちせずに IdP から教えてもらう。 */
export async function discover(): Promise<Discovery> {
  if (!discoveryCache) {
    const res = await fetch(`${config.issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`ディスカバリに失敗しました: ${res.status}`);
    const d = (await res.json()) as Discovery;
    // ディスカバリの issuer が期待した値と違うなら、別の IdP と話している
    if (d.issuer !== config.issuer) throw new Error(`issuer が違います: ${d.issuer}`);
    discoveryCache = d;
  }
  return discoveryCache;
}

/** 認可リクエストを組み立てて IdP へ遷移する。戻ってきたときのために verifier / state / nonce を保存する。 */
export async function startLogin(next?: string): Promise<void> {
  const d = await discover();
  const { verifier, challenge } = await createPkce();
  const pending: Pending = { state: randomString(16), verifier, nonce: randomString(16), next };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  location.assign(url.toString());
}

export interface CallbackResult {
  next?: string;
}

/**
 * IdP から戻ってきたとき (/callback?code=...&state=...) の処理。
 * state の確認 → コードをトークンに交換 → ID トークンの検証 → メモリに保存。
 */
export async function handleCallback(): Promise<CallbackResult> {
  const params = new URLSearchParams(location.search);
  const raw = sessionStorage.getItem(PENDING_KEY);
  // 1 回限りの値。成否にかかわらず、読んだらすぐ消す
  sessionStorage.removeItem(PENDING_KEY);
  // コードを含む URL がブラウザの履歴に残らないよう、すぐ "/" に置き換える (リロードでコードを再送しない)
  history.replaceState(null, "", "/");

  if (!raw) throw new Error("ログインの途中状態がありません (別のタブで始めたか、すでに処理済みです)");
  const pending = JSON.parse(raw) as Pending;

  const error = params.get("error");
  if (error) throw new Error(`IdP がエラーを返しました: ${error} ${params.get("error_description") ?? ""}`);
  // state が一致しないリクエストは、自分が始めたログインではない (CSRF / ログイン CSRF 対策)
  if (params.get("state") !== pending.state) throw new Error("state が一致しません");
  const code = params.get("code");
  if (!code) throw new Error("認可コードがありません");

  const d = await discover();
  // public client なので client_secret は無い。client_id と code_verifier で身元を示す
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: pending.verifier,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`トークンの取得に失敗しました: ${JSON.stringify(body)}`);

  const idToken = String(body.id_token);
  await verifySignature(idToken, d.jwks_uri);
  const { claims } = decodeJwt(idToken);
  validateIdTokenClaims(claims, { issuer: config.issuer, clientId: config.clientId, nonce: pending.nonce });

  session = {
    accessToken: String(body.access_token),
    expiresAt: Date.now() + Number(body.expires_in) * 1000,
    scope: String(body.scope),
    idTokenClaims: claims,
  };
  // public client にはリフレッシュトークンが出ない。期限が切れたら認可コードフローをやり直す
  return { next: pending.next };
}

export class TokenExpiredError extends Error {}

/** アクセストークンを付けて GET する。期限切れ (手元の期限、または 401) なら TokenExpiredError。 */
export async function authorizedGet(url: string): Promise<unknown> {
  if (!session || isExpired(session)) throw new TokenExpiredError("アクセストークンの期限が切れています");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (res.status === 401) throw new TokenExpiredError("401: アクセストークンが受け付けられませんでした");
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function callUserInfo(): Promise<unknown> {
  return authorizedGet((await discover()).userinfo_endpoint);
}
