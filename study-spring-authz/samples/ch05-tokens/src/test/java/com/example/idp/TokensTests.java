package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.OAuth2TokenFormat;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.util.UriComponentsBuilder;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * 第5章: トークンの中身・署名鍵・TokenSettings・introspection・失効・リフレッシュトークンのローテーション。
 */
@SpringBootTest
@AutoConfigureMockMvc
class TokensTests {

    private static final String REDIRECT_URI = "http://127.0.0.1:8080/login/oauth2/code/idp";
    private static final String WEB = "web-client";
    private static final String WEB_SECRET = "web-client-secret";
    private static final String OPAQUE = "opaque-client";
    private static final String OPAQUE_SECRET = "opaque-client-secret";

    @Autowired
    MockMvc mvc;

    @Autowired
    RegisteredClientRepository clients;

    // ---------------------------------------------------------------- JWK

    @Test
    void jwksに固定したkidの公開鍵だけが載り_秘密鍵は載らない() throws Exception {
        String body = mvc.perform(get("/oauth2/jwks")).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JWKSet jwkSet = JWKSet.parse(body);
        assertThat(jwkSet.getKeys()).hasSize(1);
        assertThat(jwkSet.getKeys().get(0).getKeyID()).isEqualTo("study-key-1");
        assertThat(jwkSet.getKeys().get(0).isPrivate()).isFalse();
    }

    @Test
    void アクセストークンとIDトークンの署名をjwksの公開鍵で検証できる() throws Exception {
        Map<String, Object> tokens = issueTokens(WEB, WEB_SECRET, "openid profile", "n-0S6_WzA2Mj");
        RSAKey publicKey = fetchPublicKey();

        for (String name : List.of("access_token", "id_token")) {
            SignedJWT jwt = SignedJWT.parse((String) tokens.get(name));
            // ヘッダーの kid で jwks から鍵を選ぶ (鍵が複数あるときの選び方)
            assertThat(jwt.getHeader().getKeyID()).isEqualTo(publicKey.getKeyID());
            assertThat(jwt.getHeader().getAlgorithm().getName()).isEqualTo("RS256");
            assertThat(jwt.verify(new RSASSAVerifier(publicKey))).as(name).isTrue();
        }
    }

    @Test
    void ペイロードを書き換えると署名検証に失敗する() throws Exception {
        String accessToken = (String) issueTokens(WEB, WEB_SECRET, "openid", null).get("access_token");
        String[] parts = accessToken.split("\\.");
        String forgedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(
            new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                .replace("\"sub\":\"user\"", "\"sub\":\"admin\"").getBytes(StandardCharsets.UTF_8));
        SignedJWT forged = SignedJWT.parse(parts[0] + "." + forgedPayload + "." + parts[2]);

        assertThat(forged.getJWTClaimsSet().getSubject()).isEqualTo("admin");
        assertThat(forged.verify(new RSASSAVerifier(fetchPublicKey()))).isFalse();
    }

    // ---------------------------------------------------------------- クレーム

    @Test
    void アクセストークンのクレームを確認できる() throws Exception {
        Map<String, Object> tokens = issueTokens(WEB, WEB_SECRET, "openid profile", "n-0S6_WzA2Mj");
        JWTClaimsSet claims = SignedJWT.parse((String) tokens.get("access_token")).getJWTClaimsSet();

        assertThat(claims.getIssuer()).isEqualTo("http://localhost");
        assertThat(claims.getSubject()).isEqualTo("user");
        assertThat(claims.getAudience()).containsExactly(WEB);
        assertThat(claims.getStringListClaim("scope")).containsExactly("openid", "profile");
        assertThat(claims.getJWTID()).isNotBlank();
        assertThat(claims.getNotBeforeTime()).isEqualTo(claims.getIssueTime());
        // accessTokenTimeToLive(15 分) がそのまま exp - iat になる
        assertThat(Duration.between(claims.getIssueTime().toInstant(), claims.getExpirationTime().toInstant()))
            .isEqualTo(Duration.ofMinutes(15));
        // ID トークン専用のクレームは入らない
        assertThat(claims.getClaim("nonce")).isNull();
        assertThat(claims.getClaim("auth_time")).isNull();
    }

    @Test
    void IDトークンのクレームはアクセストークンと用途が違う() throws Exception {
        Map<String, Object> tokens = issueTokens(WEB, WEB_SECRET, "openid profile", "n-0S6_WzA2Mj");
        JWTClaimsSet claims = SignedJWT.parse((String) tokens.get("id_token")).getJWTClaimsSet();

        assertThat(claims.getIssuer()).isEqualTo("http://localhost");
        assertThat(claims.getSubject()).isEqualTo("user");
        // aud は「このトークンを受け取るクライアント」。リソースサーバーに渡すものではない
        assertThat(claims.getAudience()).containsExactly(WEB);
        assertThat(claims.getStringClaim("azp")).isEqualTo(WEB);
        assertThat(claims.getStringClaim("nonce")).isEqualTo("n-0S6_WzA2Mj");
        assertThat(claims.getDateClaim("auth_time")).isNotNull();
        assertThat(claims.getStringClaim("sid")).isNotBlank();
        // scope は入らない。nbf も入らない
        assertThat(claims.getClaim("scope")).isNull();
        assertThat(claims.getNotBeforeTime()).isNull();
        // ID トークンの有効期間は TokenSettings では変えられず 30 分固定
        assertThat(Duration.between(claims.getIssueTime().toInstant(), claims.getExpirationTime().toInstant()))
            .isEqualTo(Duration.ofMinutes(30));
    }

    // ---------------------------------------------------------------- TokenSettings

    @Test
    void クライアントごとのTokenSettingsが反映されている() {
        TokenSettings web = clients.findByClientId(WEB).getTokenSettings();
        assertThat(web.getAuthorizationCodeTimeToLive()).isEqualTo(Duration.ofMinutes(2));
        assertThat(web.getAccessTokenTimeToLive()).isEqualTo(Duration.ofMinutes(15));
        assertThat(web.getRefreshTokenTimeToLive()).isEqualTo(Duration.ofHours(8));
        assertThat(web.isReuseRefreshTokens()).isFalse();
        assertThat(web.getAccessTokenFormat()).isEqualTo(OAuth2TokenFormat.SELF_CONTAINED);
        assertThat(web.getIdTokenSignatureAlgorithm().getName()).isEqualTo("RS256");

        TokenSettings opaque = clients.findByClientId(OPAQUE).getTokenSettings();
        assertThat(opaque.getAccessTokenFormat()).isEqualTo(OAuth2TokenFormat.REFERENCE);
        // 何も指定しない項目は既定値 (5 分 / 60 分 / リフレッシュトークン再利用)
        assertThat(opaque.getAccessTokenTimeToLive()).isEqualTo(Duration.ofMinutes(5));
        assertThat(opaque.getRefreshTokenTimeToLive()).isEqualTo(Duration.ofMinutes(60));
        assertThat(opaque.isReuseRefreshTokens()).isTrue();
    }

    @Test
    void リフレッシュトークンの有効期間は_introspectionのexpからも確かめられる() throws Exception {
        Map<String, Object> tokens = issueTokens(WEB, WEB_SECRET, "openid", null);
        Map<String, Object> result = introspect(WEB, WEB_SECRET, (String) tokens.get("refresh_token"));

        long iat = ((Number) result.get("iat")).longValue();
        long exp = ((Number) result.get("exp")).longValue();
        assertThat(exp - iat).isEqualTo(Duration.ofHours(8).toSeconds());
    }

    // ---------------------------------------------------------------- 参照型 + introspection

    @Test
    void 参照型のアクセストークンはJWTではなく_introspectionで中身がわかる() throws Exception {
        Map<String, Object> tokens = issueTokens(OPAQUE, OPAQUE_SECRET, "openid profile", null);
        String accessToken = (String) tokens.get("access_token");

        // JWT ではない (ドットで区切られた 3 つの部分を持たない)
        assertThat(accessToken.split("\\.")).hasSize(1);
        // ID トークンは参照型クライアントでも JWT のまま
        assertThat(((String) tokens.get("id_token")).split("\\.")).hasSize(3);

        Map<String, Object> result = introspect(OPAQUE, OPAQUE_SECRET, accessToken);
        assertThat(result.get("active")).isEqualTo(true);
        assertThat(result.get("sub")).isEqualTo("user");
        assertThat(result.get("client_id")).isEqualTo(OPAQUE);
        assertThat(result.get("scope")).isEqualTo("openid profile");
        assertThat(result.get("token_type")).isEqualTo("Bearer");
        assertThat(result.get("aud")).isEqualTo(List.of(OPAQUE));
        assertThat(result).containsKeys("iss", "iat", "nbf", "exp", "jti");
    }

    @Test
    void 知らないトークンのintrospectionはactiveがfalseだけを返す() throws Exception {
        assertThat(introspect(WEB, WEB_SECRET, "not-a-token")).isEqualTo(Map.of("active", false));
    }

    // ---------------------------------------------------------------- 失効

    @Test
    void JWTのアクセストークンを失効させるとintrospectionはfalseだが_自前検証では有効なまま() throws Exception {
        String accessToken = (String) issueTokens(WEB, WEB_SECRET, "openid", null).get("access_token");

        // リソースサーバーが jwks の公開鍵だけで検証する場合の検証器
        NimbusJwtDecoder selfVerifier = NimbusJwtDecoder.withPublicKey(
            fetchPublicKey().toRSAPublicKey()).build();
        assertThat(selfVerifier.decode(accessToken).getSubject()).isEqualTo("user");
        assertThat(introspect(WEB, WEB_SECRET, accessToken).get("active")).isEqualTo(true);

        // RFC 7009: 失効は成功すれば 200
        mvc.perform(post("/oauth2/revoke")
                .with(httpBasic(WEB, WEB_SECRET))
                .param("token", accessToken)
                .param("token_type_hint", "access_token"))
            .andExpect(status().isOk());

        // IdP に聞く方式 (introspection) では無効になる
        assertThat(introspect(WEB, WEB_SECRET, accessToken)).isEqualTo(Map.of("active", false));
        // IdP の UserInfo エンドポイントも保管庫を見るので拒否する
        mvc.perform(get("/userinfo").header("Authorization", "Bearer " + accessToken))
            .andExpect(status().isUnauthorized());
        // しかし署名と exp だけを見る自前検証は、失効を知らないので通ってしまう
        Jwt stillValid = selfVerifier.decode(accessToken);
        assertThat(stillValid.getSubject()).isEqualTo("user");
        assertThat(stillValid.getExpiresAt()).isAfter(Instant.now());
    }

    @Test
    void リフレッシュトークンを失効させると同じ認可のアクセストークンも無効になる() throws Exception {
        Map<String, Object> tokens = issueTokens(OPAQUE, OPAQUE_SECRET, "openid", null);
        String accessToken = (String) tokens.get("access_token");
        String refreshToken = (String) tokens.get("refresh_token");
        assertThat(introspect(OPAQUE, OPAQUE_SECRET, accessToken).get("active")).isEqualTo(true);

        mvc.perform(post("/oauth2/revoke")
                .with(httpBasic(OPAQUE, OPAQUE_SECRET))
                .param("token", refreshToken)
                .param("token_type_hint", "refresh_token"))
            .andExpect(status().isOk());

        assertThat(introspect(OPAQUE, OPAQUE_SECRET, refreshToken).get("active")).isEqualTo(false);
        assertThat(introspect(OPAQUE, OPAQUE_SECRET, accessToken).get("active")).isEqualTo(false);
    }

    // ---------------------------------------------------------------- リフレッシュトークン

    @Test
    void reuseRefreshTokensがfalseだと更新のたびに新しいリフレッシュトークンになり_古いものは使えない() throws Exception {
        String oldRefreshToken = (String) issueTokens(WEB, WEB_SECRET, "openid", null).get("refresh_token");

        String body = refresh(WEB, WEB_SECRET, oldRefreshToken).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        String newRefreshToken = JsonPath.read(body, "$.refresh_token");
        assertThat(newRefreshToken).isNotEqualTo(oldRefreshToken);

        refresh(WEB, WEB_SECRET, oldRefreshToken)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
        refresh(WEB, WEB_SECRET, newRefreshToken).andExpect(status().isOk());
    }

    @Test
    void reuseRefreshTokensが既定のtrueだと同じリフレッシュトークンが返り続ける() throws Exception {
        String refreshToken = (String) issueTokens(OPAQUE, OPAQUE_SECRET, "openid", null).get("refresh_token");

        String body = refresh(OPAQUE, OPAQUE_SECRET, refreshToken).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(body, "$.refresh_token")).isEqualTo(refreshToken);
    }

    // ---------------------------------------------------------------- ヘルパー

    private ResultActions refresh(String clientId, String secret, String token)
            throws Exception {
        return mvc.perform(post("/oauth2/token")
            .with(httpBasic(clientId, secret))
            .param("grant_type", "refresh_token")
            .param("refresh_token", token));
    }

    private Map<String, Object> introspect(String clientId, String secret, String token) throws Exception {
        String body = mvc.perform(post("/oauth2/introspect")
                .with(httpBasic(clientId, secret))
                .param("token", token))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$");
    }

    /** /oauth2/jwks から公開鍵を取得する。リソースサーバーが行うのと同じ手順。 */
    private RSAKey fetchPublicKey() throws Exception {
        String body = mvc.perform(get("/oauth2/jwks")).andReturn().getResponse().getContentAsString();
        return (RSAKey) JWKSet.parse(body).getKeys().get(0);
    }

    /** ログイン → 認可リクエスト → トークンリクエストまでを通して、トークンレスポンスの JSON を返す。 */
    private Map<String, Object> issueTokens(String clientId, String secret, String scope, String nonce)
            throws Exception {
        String verifier = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

        MockHttpSession session = (MockHttpSession) mvc.perform(formLogin().user("user").password("password"))
            .andExpect(authenticated())
            .andReturn().getRequest().getSession(false);

        var authorizeRequest = get("/oauth2/authorize")
            .session(session)
            .queryParam("response_type", "code")
            .queryParam("client_id", clientId)
            .queryParam("redirect_uri", REDIRECT_URI)
            .queryParam("scope", scope)
            .queryParam("state", "xyz")
            .queryParam("code_challenge", challenge(verifier))
            .queryParam("code_challenge_method", "S256");
        if (nonce != null) {
            authorizeRequest.queryParam("nonce", nonce);
        }
        MvcResult authorize = mvc.perform(authorizeRequest).andExpect(status().is3xxRedirection()).andReturn();
        String code = UriComponentsBuilder.fromUriString(authorize.getResponse().getRedirectedUrl())
            .build().getQueryParams().getFirst("code");

        String body = mvc.perform(post("/oauth2/token")
                .with(httpBasic(clientId, secret))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", REDIRECT_URI)
                .param("code_verifier", verifier))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$");
    }

    private static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
