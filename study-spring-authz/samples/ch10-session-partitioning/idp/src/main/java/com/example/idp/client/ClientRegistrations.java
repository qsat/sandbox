package com.example.idp.client;

import java.time.Duration;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.OAuth2TokenFormat;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;

/**
 * この IdP に登録するクライアントの定義。台帳 (DB) への書き込みは {@link com.example.idp.seed.DataSeeder} が行う。
 *
 * <p>応用編でクライアントを増やすときは、ここにメソッドを足す。
 * 値は学習用の固定値 (web-client-secret など)。本番では使わないこと。
 */
public final class ClientRegistrations {

    /** リソースサーバー (ノート API) を呼ぶための scope。 */
    public static final String SCOPE_API_READ = "api.read";

    private ClientRegistrations() {
    }

    /**
     * Web クライアント: confidential client (サーバーサイドの Web アプリ。client_secret を守れる)。
     * 同意画面を出す (サードパーティ想定)。
     */
    public static RegisteredClient webClient(PasswordEncoder passwordEncoder, Duration accessTokenTimeToLive) {
        return RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            .clientName("Web Client")
            // client_secret は必ずハッシュにして保存する (DB が漏れても元の値が分からないように)
            .clientSecret(passwordEncoder.encode("web-client-secret"))
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            // redirect_uri は登録値との完全一致で検証される。
            // Web クライアントは localhost ではなく 127.0.0.1 で開く (Cookie の衝突を避けるため。本文参照)
            .redirectUri("http://127.0.0.1:8080/login/oauth2/code/idp")
            .postLogoutRedirectUri("http://127.0.0.1:8080/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .scope(OidcScopes.EMAIL)
            .scope(SCOPE_API_READ)
            .clientSettings(ClientSettings.builder()
                // confidential client でも PKCE を必須にする (OAuth 2.1 の方針)
                .requireProofKey(true)
                .requireAuthorizationConsent(true)
                .build())
            .tokenSettings(tokenSettings(accessTokenTimeToLive))
            .build();
    }

    /**
     * SPA: public client (ブラウザで動くので秘密を持てない)。
     * 自社の SPA という想定で、同意画面は出さない (同意を出すかどうかは client ごとの方針)。
     */
    public static RegisteredClient spaClient(Duration accessTokenTimeToLive) {
        return RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("spa-client")
            .clientName("SPA Client")
            // public client は秘密を持たないので、クライアント認証は NONE。clientSecret も設定しない
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            // 登録しても public client にリフレッシュトークンは発行されない (4 章)。SPA は認可コードフローをやり直す
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://127.0.0.1:5173/callback")
            .postLogoutRedirectUri("http://127.0.0.1:5173/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .scope(OidcScopes.EMAIL)
            .scope(SCOPE_API_READ)
            .clientSettings(ClientSettings.builder()
                // public client では PKCE が唯一の防御なので必須にする
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            .tokenSettings(tokenSettings(accessTokenTimeToLive))
            .build();
    }

    /** 5 章の TokenSettings。既定値と違う項目にコメントを付けている。 */
    private static TokenSettings tokenSettings(Duration accessTokenTimeToLive) {
        return TokenSettings.builder()
            .authorizationCodeTimeToLive(Duration.ofMinutes(2))   // 既定 5 分
            .accessTokenTimeToLive(accessTokenTimeToLive)         // 既定 5 分。application.yml の idp.token.access-token-ttl (既定 15 分)
            .refreshTokenTimeToLive(Duration.ofHours(8))          // 既定 60 分
            .reuseRefreshTokens(false)                            // 既定 true。更新のたびに新しいリフレッシュトークンを発行する
            .accessTokenFormat(OAuth2TokenFormat.SELF_CONTAINED)  // 既定。JWT
            .build();
    }
}
