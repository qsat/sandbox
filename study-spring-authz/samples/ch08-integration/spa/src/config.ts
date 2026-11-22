/** IdP とリソースサーバーの場所、このクライアントの登録内容。IdP 側の登録 (ClientRegistrations.spaClient) と合わせる。 */
export const config = {
  // issuer は IdP の設定と完全一致させる。ID トークンの iss の検証に使う
  issuer: "http://localhost:9000",
  clientId: "spa-client",
  redirectUri: "http://127.0.0.1:5173/callback",
  scope: "openid profile email api.read",
  resourceServer: "http://localhost:8090",
};
