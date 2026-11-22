package com.example.idp;

import static com.example.idp.FlowSupport.VERIFIER;
import static com.example.idp.FlowSupport.WEB;
import static com.example.idp.FlowSupport.WEB_REDIRECT;
import static com.example.idp.FlowSupport.WEB_SECRET;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.OAuth2TokenFormat;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.test.web.servlet.MockMvc;

/** 5 章: トークンの中身・署名鍵・TokenSettings・introspection・失効・リフレッシュトークンのローテーション。 */
@SpringBootTest
@AutoConfigureMockMvc
class TokensTests {

    private static final String OPAQUE = "opaque-client";
    private static final String OPAQUE_SECRET = "opaque-client-secret";

    @Autowired
    MockMvc mvc;

    @Autowired
    RegisteredClientRepository clients;

    @Autowired
    PasswordEncoder passwordEncoder;

    FlowSupport flow;

    @BeforeEach
    void setUp() {
        flow = new FlowSupport(mvc);
        // 参照型 (opaque) のアクセストークンを試すための、テスト専用のクライアント (IdP には登録していない)
        if (clients.findByClientId(OPAQUE) == null) {
            clients.save(RegisteredClient.withId(UUID.randomUUID().toString())
                .clientId(OPAQUE)
                .clientSecret(passwordEncoder.encode(OPAQUE_SECRET))
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
                .redirectUri(WEB_REDIRECT)
                .scope("openid")
                .scope("profile")
                .clientSettings(ClientSettings.builder().requireProofKey(true).requireAuthorizationConsent(false).build())
                .tokenSettings(TokenSettings.builder().accessTokenFormat(OAuth2TokenFormat.REFERENCE).build())
                .build());
        }
    }

    // ---------------------------------------------------------------- JWK と署名

    @Test
    void jwksに鍵のサムプリントをkidとした公開鍵だけが載り_秘密鍵は載らない() throws Exception {
        String body = mvc.perform(get("/oauth2/jwks")).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JWKSet jwkSet = JWKSet.parse(body);
        assertThat(jwkSet.getKeys()).hasSize(1);
        // kid は鍵から導いた JWK Thumbprint (RFC 7638)
        assertThat(jwkSet.getKeys().get(0).getKeyID())
            .isEqualTo(jwkSet.getKeys().get(0).computeThumbprint().toString());
        assertThat(jwkSet.getKeys().get(0).isPrivate()).isFalse();
    }

    @Test
    void アクセストークンとIDトークンの署名をjwksの公開鍵で検証できる() throws Exception {
        Map<String, Object> tokens = flow.issueWebTokens("openid profile");
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
        String accessToken = (String) flow.issueWebTokens("openid").get("access_token");
        String[] parts = accessToken.split("\\.");
        String forgedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(
            new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                .replace("\"sub\":\"alice\"", "\"sub\":\"admin\"").getBytes(StandardCharsets.UTF_8));
        SignedJWT forged = SignedJWT.parse(parts[0] + "." + forgedPayload + "." + parts[2]);

        assertThat(forged.getJWTClaimsSet().getSubject()).isEqualTo("admin");
        assertThat(forged.verify(new RSASSAVerifier(fetchPublicKey()))).isFalse();
    }

    // ---------------------------------------------------------------- クレーム

    @Test
    void アクセストークンのクレームを確認できる() throws Exception {
        Map<String, Object> tokens = flow.issueWebTokens("openid profile api.read");
        JWTClaimsSet claims = SignedJWT.parse((String) tokens.get("access_token")).getJWTClaimsSet();

        assertThat(claims.getIssuer()).isEqualTo("http://localhost:9000");
        assertThat(claims.getSubject()).isEqualTo("alice");
        // aud は既定ではクライアントの client_id。リソースサーバーの識別子ではない (audience の設計は 9 章)
        assertThat(claims.getAudience()).containsExactly(WEB);
        assertThat(claims.getStringListClaim("scope")).containsExactly("openid", "profile", "api.read");
        assertThat(claims.getJWTID()).isNotBlank();
        // accessTokenTimeToLive (既定 15 分) がそのまま exp - iat になる
        assertThat(Duration.between(claims.getIssueTime().toInstant(), claims.getExpirationTime().toInstant()))
            .isEqualTo(Duration.ofMinutes(15));
        // ID トークン専用のクレームは入らない
        assertThat(claims.getClaim("nonce")).isNull();
        assertThat(claims.getClaim("auth_time")).isNull();
    }

    @Test
    void IDトークンのクレームはアクセストークンと用途が違う() throws Exception {
        Map<String, Object> tokens = flow.issueWebTokens("openid profile");
        JWTClaimsSet claims = SignedJWT.parse((String) tokens.get("id_token")).getJWTClaimsSet();

        assertThat(claims.getIssuer()).isEqualTo("http://localhost:9000");
        assertThat(claims.getSubject()).isEqualTo("alice");
        assertThat(claims.getAudience()).containsExactly(WEB);
        assertThat(claims.getStringClaim("azp")).isEqualTo(WEB);
        assertThat(claims.getStringClaim("nonce")).isEqualTo("n-0S6_WzA2Mj");
        assertThat(claims.getDateClaim("auth_time")).isNotNull();
        assertThat(claims.getStringClaim("sid")).isNotBlank();
        assertThat(claims.getClaim("scope")).isNull();
        // ID トークンの有効期間は TokenSettings では変えられず 30 分固定
        assertThat(Duration.between(claims.getIssueTime().toInstant(), claims.getExpirationTime().toInstant()))
            .isEqualTo(Duration.ofMinutes(30));
    }

    // ---------------------------------------------------------------- TokenSettings

    @Test
    void クライアントごとのTokenSettingsが反映されている() {
        for (String clientId : List.of("web-client", "spa-client")) {
            TokenSettings settings = clients.findByClientId(clientId).getTokenSettings();
            assertThat(settings.getAuthorizationCodeTimeToLive()).as(clientId).isEqualTo(Duration.ofMinutes(2));
            assertThat(settings.getAccessTokenTimeToLive()).as(clientId).isEqualTo(Duration.ofMinutes(15));
            assertThat(settings.getRefreshTokenTimeToLive()).as(clientId).isEqualTo(Duration.ofHours(8));
            assertThat(settings.isReuseRefreshTokens()).as(clientId).isFalse();
            assertThat(settings.getAccessTokenFormat()).as(clientId).isEqualTo(OAuth2TokenFormat.SELF_CONTAINED);
        }
    }

    // ---------------------------------------------------------------- 参照型 + introspection

    @Test
    void 参照型のアクセストークンはJWTではなく_introspectionで中身がわかる() throws Exception {
        String code = flow.obtainCode(flow.loginAlice(), OPAQUE, WEB_REDIRECT);
        String body = flow.exchange(OPAQUE, OPAQUE_SECRET, code, WEB_REDIRECT, VERIFIER)
            .andReturn().getResponse().getContentAsString();
        String accessToken = JsonPath.read(body, "$.access_token");

        assertThat(accessToken.split("\\.")).hasSize(1);
        assertThat(JsonPath.<String>read(body, "$.id_token").split("\\.")).hasSize(3);

        Map<String, Object> result = introspect(OPAQUE, OPAQUE_SECRET, accessToken);
        assertThat(result.get("active")).isEqualTo(true);
        assertThat(result.get("sub")).isEqualTo("alice");
        assertThat(result.get("client_id")).isEqualTo(OPAQUE);
        assertThat(result.get("scope")).isEqualTo("openid profile");
    }

    @Test
    void 知らないトークンのintrospectionはactiveがfalseだけを返す() throws Exception {
        assertThat(introspect(WEB, WEB_SECRET, "not-a-token")).isEqualTo(Map.of("active", false));
    }

    // ---------------------------------------------------------------- 失効

    @Test
    void JWTのアクセストークンを失効させるとintrospectionはfalseだが_自前検証では有効なまま() throws Exception {
        String accessToken = (String) flow.issueWebTokens("openid").get("access_token");

        // リソースサーバーが jwks の公開鍵だけで検証する場合の検証器
        NimbusJwtDecoder selfVerifier = NimbusJwtDecoder.withPublicKey(fetchPublicKey().toRSAPublicKey()).build();
        assertThat(selfVerifier.decode(accessToken).getSubject()).isEqualTo("alice");
        assertThat(introspect(WEB, WEB_SECRET, accessToken).get("active")).isEqualTo(true);

        mvc.perform(post("/oauth2/revoke")
                .with(httpBasic(WEB, WEB_SECRET))
                .param("token", accessToken)
                .param("token_type_hint", "access_token"))
            .andExpect(status().isOk());

        // IdP に聞く方式 (introspection) では無効になる
        assertThat(introspect(WEB, WEB_SECRET, accessToken)).isEqualTo(Map.of("active", false));
        // しかし署名と exp だけを見る自前検証は、失効を知らないので通ってしまう
        Jwt stillValid = selfVerifier.decode(accessToken);
        assertThat(stillValid.getExpiresAt()).isAfter(Instant.now());
    }

    // ---------------------------------------------------------------- リフレッシュトークン

    @Test
    void 更新のたびに新しいリフレッシュトークンになり_古いものは使えない() throws Exception {
        String oldRefreshToken = (String) flow.issueWebTokens("openid").get("refresh_token");

        String body = flow.refresh(WEB, WEB_SECRET, oldRefreshToken, null).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        String newRefreshToken = JsonPath.read(body, "$.refresh_token");
        assertThat(newRefreshToken).isNotEqualTo(oldRefreshToken);

        flow.refresh(WEB, WEB_SECRET, oldRefreshToken, null)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
        flow.refresh(WEB, WEB_SECRET, newRefreshToken, null).andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- ヘルパー

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
}
