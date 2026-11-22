import { describe, expect, it } from "vitest";
import { base64url, decodeJwt, validateIdTokenClaims } from "./idtoken";
import { randomString, s256Challenge } from "./pkce";

describe("PKCE", () => {
  it("RFC 7636 付録 B の例で S256 のチャレンジが計算できる", async () => {
    expect(await s256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("32 バイトの乱数は 43 文字の base64url になり、毎回違う", () => {
    const a = randomString(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString(32)).not.toBe(a);
  });

  it("base64url は + / = を含まない", () => {
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe("-__-");
  });
});

function jwt(claims: object): string {
  const enc = (o: object) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: "RS256", kid: "k" })}.${enc(claims)}.c2ln`;
}

describe("ID トークンの検証", () => {
  const expected = { issuer: "http://localhost:9000", clientId: "spa-client", nonce: "n1", now: 1000 };
  const valid = { iss: "http://localhost:9000", aud: ["spa-client"], nonce: "n1", exp: 2000 };

  it("正しいクレームは通る", () => {
    expect(() => validateIdTokenClaims(decodeJwt(jwt(valid)).claims, expected)).not.toThrow();
  });

  it.each([
    ["iss が違う", { ...valid, iss: "http://evil.example" }],
    ["aud に自分がいない", { ...valid, aud: ["other-client"] }],
    ["nonce が違う", { ...valid, nonce: "n2" }],
    ["期限切れ", { ...valid, exp: 900 }],
    ["aud が複数で azp が自分でない", { ...valid, aud: ["spa-client", "x"], azp: "x" }],
  ])("%s なら拒否する", (_name, claims) => {
    expect(() => validateIdTokenClaims(decodeJwt(jwt(claims)).claims, expected)).toThrow();
  });

  it("時計のずれ (60 秒) までは期限切れとしない", () => {
    expect(() => validateIdTokenClaims({ ...valid, exp: 950 }, expected)).not.toThrow();
  });
});
