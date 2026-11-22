package com.example.resource;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * リソースサーバーのテスト。
 *
 * <p>本物の IdP を起動する代わりに、テスト用の鍵で署名した JWT を自分で作り、
 * その公開鍵を配る小さな HTTP サーバー (jwks の代役) を立てる。
 * JwtDecoder は application.yml と同じ自動構成のまま、jwk-set-uri だけをテスト用に差し替えている。
 * つまり「署名・exp・iss の検証」は本番と同じコードで動いている。
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiTests {

    private static final String ISSUER = "http://localhost:9000";
    private static final String SPA_ORIGIN = "http://127.0.0.1:5173";

    private static RSAKey signingKey;
    private static HttpServer jwksServer;

    @BeforeAll
    static void startJwksServer() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("test-key").generate();
        byte[] body = new JWKSet(signingKey.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jwksServer.createContext("/oauth2/jwks", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        jwksServer.start();
    }

    @AfterAll
    static void stopJwksServer() {
        jwksServer.stop(0);
    }

    @DynamicPropertySource
    static void jwkSetUri(DynamicPropertyRegistry registry) {
        // Spring のコンテキストは @BeforeAll のあとに作られるので、この時点で jwksServer は起動済み
        registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri",
            () -> "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/oauth2/jwks");
    }

    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- 認証 (401)

    @Test
    void トークンなしは401() throws Exception {
        mvc.perform(get("/api/me"))
            .andExpect(status().isUnauthorized())
            // Spring Security 7 は resource_metadata (RFC 9728 の保護リソースメタデータの場所) も付ける
            .andExpect(header().string("WWW-Authenticate", org.hamcrest.Matchers.startsWith("Bearer")));
        mvc.perform(get("/api/notes")).andExpect(status().isUnauthorized());
    }

    @Test
    void 署名が違うトークンは401() throws Exception {
        RSAKey other = new RSAKeyGenerator(2048).keyID("test-key").generate();   // kid は同じだが鍵が違う

        mvc.perform(get("/api/me").header("Authorization", "Bearer " + token(other, ISSUER, "alice", "api.read", 300)))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void issが違うトークンは401() throws Exception {
        mvc.perform(get("/api/me")
                .header("Authorization", "Bearer " + token(signingKey, "http://evil.example", "alice", "api.read", 300)))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void 期限切れのトークンは401() throws Exception {
        // 既定で 60 秒の時計のずれ (clock skew) を許すので、それより前に切れたトークンにする
        mvc.perform(get("/api/me")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "api.read", -120)))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void 改ざんされたトークンは401() throws Exception {
        String[] parts = token(signingKey, ISSUER, "alice", "api.read", 300).split("\\.");
        String forgedPayload = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
            new String(java.util.Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                .replace("alice", "admin").getBytes(StandardCharsets.UTF_8));

        mvc.perform(get("/api/me").header("Authorization", "Bearer " + parts[0] + "." + forgedPayload + "." + parts[2]))
            .andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- 認可 (403)

    @Test
    void scopeが足りないと403() throws Exception {
        mvc.perform(get("/api/notes")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "openid profile", 300)))
            .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------- 正常系

    @Test
    void me_はトークンのsubとscopeを返す() throws Exception {
        mvc.perform(get("/api/me")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "openid api.read", 300)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sub").value("alice"))
            .andExpect(jsonPath("$.scope[0]").value("openid"))
            .andExpect(jsonPath("$.scope[1]").value("api.read"))
            .andExpect(jsonPath("$.iss").value(ISSUER));
    }

    @Test
    void me_はapi_readが無くても有効なトークンなら呼べる() throws Exception {
        mvc.perform(get("/api/me")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "openid", 300)))
            .andExpect(status().isOk());
    }

    @Test
    void notes_はapi_readがあれば呼べて_持ち主はsubで決まる() throws Exception {
        mvc.perform(get("/api/notes")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "api.read", 300)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.owner").value("alice"))
            .andExpect(jsonPath("$.notes.length()").value(2));

        mvc.perform(get("/api/notes")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "bob", "api.read", 300)))
            .andExpect(jsonPath("$.owner").value("bob"))
            .andExpect(jsonPath("$.notes.length()").value(1));
    }

    @Test
    void 公開していないパスは認証しても拒否される() throws Exception {
        mvc.perform(get("/internal")
                .header("Authorization", "Bearer " + token(signingKey, ISSUER, "alice", "api.read", 300)))
            .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------- CORS

    @Test
    void SPAのオリジンからのプリフライトは許可される() throws Exception {
        mvc.perform(options("/api/notes")
                .header("Origin", SPA_ORIGIN)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", SPA_ORIGIN))
            .andExpect(header().string("Access-Control-Allow-Methods", "GET"));
    }

    @Test
    void 別のオリジンは許可されない() throws Exception {
        mvc.perform(options("/api/notes")
                .header("Origin", "http://evil.example")
                .header("Access-Control-Request-Method", "GET"))
            .andExpect(status().isForbidden());
    }

    @Test
    void 認証エラーの応答にもCORSヘッダーが付く() throws Exception {
        // 付かないと、ブラウザの JavaScript には 401 ではなく「CORS エラー」にしか見えず、原因が分かりにくい
        mvc.perform(get("/api/notes").header("Origin", SPA_ORIGIN))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("Access-Control-Allow-Origin", SPA_ORIGIN));
    }

    // ---------------------------------------------------------------- ヘルパー

    /** IdP の代わりにテスト用の鍵で署名した JWT を作る。ttlSeconds が負なら期限切れ。 */
    private static String token(RSAKey key, String issuer, String sub, String scope, long ttlSeconds)
            throws JOSEException {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(issuer)
            .subject(sub)
            .audience("web-client")
            .claim("scope", List.of(scope.split(" ")))
            .issueTime(Date.from(now.minusSeconds(600)))
            .expirationTime(Date.from(now.plusSeconds(ttlSeconds)))
            .jwtID(UUID.randomUUID().toString())
            .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}
