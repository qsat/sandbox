/** PKCE (RFC 7636) と state / nonce の生成。Web Crypto だけで書く。 */

/** バイト列を base64url (RFC 4648 §5。+ と / を - と _ にし、末尾の = を付けない) にする。 */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 暗号論的乱数 (crypto.getRandomValues) から作ったランダム文字列。Math.random() は予測できるので使わない。 */
export function randomString(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))  (RFC 7636 §4.2 の S256) */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** code_verifier は 43〜128 文字。32 バイトの乱数を base64url にすると 43 文字になる。 */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(32);
  return { verifier, challenge: await s256Challenge(verifier) };
}
