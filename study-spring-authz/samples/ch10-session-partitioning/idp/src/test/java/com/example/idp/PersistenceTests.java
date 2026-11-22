package com.example.idp;

import static com.example.idp.FlowSupport.WEB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.Base64;
import java.util.Map;

import com.example.idp.seed.DataSeeder;
import com.example.idp.user.UserAccountDetails;
import com.jayway.jsonpath.JsonPath;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsent;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/** 7 章: JDBC 永続化、再起動をまたいだリフレッシュ、シードの冪等性。8 章: 独自の UserDetails の保存。 */
@SpringBootTest
@AutoConfigureMockMvc
class PersistenceTests {

    @Value("${spring.datasource.url}")
    String dbUrl;

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired RegisteredClientRepository clients;
    @Autowired OAuth2AuthorizationService authorizationService;
    @Autowired OAuth2AuthorizationConsentService consentService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired DataSeeder seeder;

    @Test
    void フローを通すと認可の行がDBに保存されトークン値がそのまま入っている() throws Exception {
        Map<String, Object> tokens = new FlowSupport(mvc).issueWebTokens("openid profile");
        String accessToken = (String) tokens.get("access_token");
        String refreshToken = (String) tokens.get("refresh_token");

        // BLOB 列は UTF-8 の文字列として読み出す
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT principal_name, authorized_scopes, access_token_type,"
                + " UTF8TOSTRING(access_token_value) AS access_token_value,"
                + " UTF8TOSTRING(refresh_token_value) AS refresh_token_value"
                + " FROM oauth2_authorization WHERE UTF8TOSTRING(refresh_token_value) = ?",
            refreshToken);

        assertThat(row.get("PRINCIPAL_NAME")).isEqualTo("alice");
        assertThat(row.get("AUTHORIZED_SCOPES")).isEqualTo("openid,profile");
        assertThat(row.get("ACCESS_TOKEN_TYPE")).isEqualTo("Bearer");
        // トークン値はハッシュ化されず、クライアントに返した値そのものが入っている
        assertThat(row.get("ACCESS_TOKEN_VALUE")).isEqualTo(accessToken);
        assertThat(row.get("REFRESH_TOKEN_VALUE")).isEqualTo(refreshToken);
    }

    @Test
    void ログイン中のユーザーがattributesに型名つきで保存され_パスワードハッシュは入らない() throws Exception {
        String refreshToken = new FlowSupport(mvc).issueWebTokens("openid").get("refresh_token").toString();

        String attributes = jdbc.queryForObject(
            "SELECT UTF8TOSTRING(attributes) FROM oauth2_authorization WHERE UTF8TOSTRING(refresh_token_value) = ?",
            String.class, refreshToken);

        assertThat(attributes).contains("\"@class\":\"" + UserAccountDetails.class.getName() + "\"");
        assertThat(attributes).contains("\"username\":\"alice\"");
        // 認証が済むと UserAccountDetails#eraseCredentials() でハッシュが消える。消さないと DB に残る
        assertThat(attributes).contains("\"passwordHash\":null").doesNotContain("{bcrypt}");
    }

    @Test
    void 保存した認可を読み戻すとログイン中のユーザーがUserAccountDetailsとして復元される() throws Exception {
        String accessToken = new FlowSupport(mvc).issueWebTokens("openid").get("access_token").toString();

        OAuth2Authorization authorization = authorizationService.findByToken(accessToken, OAuth2TokenType.ACCESS_TOKEN);

        UsernamePasswordAuthenticationToken principal = authorization.getAttribute(Principal.class.getName());
        UserAccountDetails details = (UserAccountDetails) principal.getPrincipal();
        assertThat(details.getAccount().username()).isEqualTo("alice");
        assertThat(details.getAccount().displayName()).isEqualTo("Alice Example");
        assertThat(details.getAccount().passwordHash()).isNull();
    }

    @Test
    void 許可リストに登録しない標準のJDBC実装では_保存した認可を読み戻せない() throws Exception {
        new FlowSupport(mvc).issueWebTokens("openid");
        String id = jdbc.queryForObject("SELECT id FROM oauth2_authorization LIMIT 1", String.class);

        // PersistenceConfig の JsonMapper を使わない、素の JdbcOAuth2AuthorizationService
        JdbcOAuth2AuthorizationService standard = new JdbcOAuth2AuthorizationService(jdbc, clients);

        assertThatThrownBy(() -> standard.findById(id))
            .hasMessageContaining(UserAccountDetails.class.getName())
            .hasMessageContaining("denied resolution");
        // 登録した設定の側 (アプリの Bean) では読める
        assertThat(authorizationService.findById(id)).isNotNull();
    }

    @Test
    void 再起動相当の別コンテキストから同じリフレッシュトークンで更新できる() throws Exception {
        Map<String, Object> first = new FlowSupport(mvc).issueWebTokens("openid profile");
        String refreshToken = (String) first.get("refresh_token");
        String oldAccessToken = (String) first.get("access_token");

        // 同じ DB・同じ鍵ファイルを見る 2 つ目のアプリケーション (= 再起動後の IdP)。1 つ目とは Bean もメモリも共有しない
        try (ConfigurableApplicationContext restarted = new SpringApplicationBuilder(IdpApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.port=0", "spring.datasource.url=" + dbUrl)
                .run()) {
            int port = ((WebServerApplicationContext) restarted).getWebServer().getPort();
            RestClient client = RestClient.builder().baseUrl("http://localhost:" + port).build();

            // 起動前に発行した JWT も、同じ鍵なので検証できる (署名鍵がメモリ上のままだと 401 になる。7 章)
            String userInfo = client.get().uri("/userinfo")
                .headers(h -> h.setBearerAuth(oldAccessToken))
                .retrieve().body(String.class);
            assertThat(JsonPath.<String>read(userInfo, "$.sub")).isEqualTo("alice");

            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("grant_type", "refresh_token");
            form.add("refresh_token", refreshToken);
            String refreshed = client.post().uri("/oauth2/token")
                .headers(h -> h.setBasicAuth(WEB, FlowSupport.WEB_SECRET))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve().body(String.class);

            assertThat(JsonPath.<String>read(refreshed, "$.access_token")).isNotBlank();
            // 署名鍵はファイルから読むので、再起動しても kid は変わらない (5 章)
            assertThat(kidOf(JsonPath.read(refreshed, "$.access_token"))).isEqualTo(kidOf(oldAccessToken));
            // 更新後は新しいアクセストークンに入れ替わる (同じ認可の中のアクセストークンは常に 1 つ)
            assertThat(client.get().uri("/userinfo")
                .headers(h -> h.setBearerAuth(JsonPath.read(refreshed, "$.access_token")))
                .retrieve().body(String.class)).contains("\"sub\":\"alice\"");
        }
    }

    @Test
    void 初期データの投入は何度実行しても行が増えない() throws Exception {
        seeder.run(null);
        seeder.run(null);

        assertThat(count("SELECT COUNT(*) FROM oauth2_registered_client WHERE client_id = 'web-client'")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM oauth2_registered_client WHERE client_id = 'spa-client'")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM app_user")).isEqualTo(3);
    }

    @Test
    void クライアントシークレットとユーザーのパスワードはハッシュで保存される() {
        String clientSecret = jdbc.queryForObject(
            "SELECT client_secret FROM oauth2_registered_client WHERE client_id = 'web-client'", String.class);
        String password = jdbc.queryForObject(
            "SELECT password_hash FROM app_user WHERE username = 'alice'", String.class);

        assertThat(clientSecret).startsWith("{bcrypt}").doesNotContain("web-client-secret");
        assertThat(passwordEncoder.matches("web-client-secret", clientSecret)).isTrue();
        assertThat(password).startsWith("{bcrypt}").doesNotContain("password}");
        assertThat(passwordEncoder.matches("password", password)).isTrue();
        // public client は secret を持たない
        assertThat(jdbc.queryForObject(
            "SELECT client_secret FROM oauth2_registered_client WHERE client_id = 'spa-client'", String.class))
            .isNull();
    }

    @Test
    void クライアントの設定がDBから読み戻せる() {
        RegisteredClient web = clients.findByClientId("web-client");
        RegisteredClient spa = clients.findByClientId("spa-client");

        assertThat(web.getScopes()).containsExactlyInAnyOrder("openid", "profile", "email", "api.read");
        assertThat(web.getClientSettings().isRequireProofKey()).isTrue();
        assertThat(web.getClientSettings().isRequireAuthorizationConsent()).isTrue();
        assertThat(spa.getScopes()).contains("api.read");
        assertThat(spa.getClientSettings().isRequireAuthorizationConsent()).isFalse();
        assertThat(spa.getClientAuthenticationMethods()).extracting("value").containsExactly("none");
    }

    @Test
    void 同意をDBに保存して読み戻せる() {
        RegisteredClient client = clients.findByClientId(WEB);
        consentService.save(OAuth2AuthorizationConsent.withId(client.getId(), "consent-user")
            .scope("openid").scope("profile").build());

        OAuth2AuthorizationConsent loaded = consentService.findById(client.getId(), "consent-user");
        assertThat(loaded.getScopes()).containsExactlyInAnyOrder("openid", "profile");
        // authorities 列には SCOPE_ 付きのカンマ区切りで入る
        String authorities = jdbc.queryForObject(
            "SELECT authorities FROM oauth2_authorization_consent WHERE principal_name = 'consent-user'",
            String.class);
        assertThat(authorities.split(",")).containsExactlyInAnyOrder("SCOPE_openid", "SCOPE_profile");
    }

    // ---- ヘルパー ----

    private int count(String sql) {
        return jdbc.queryForObject(sql, Integer.class);
    }

    private static String kidOf(String jwt) {
        String header = new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[0]), StandardCharsets.UTF_8);
        return JsonPath.read(header, "$.kid");
    }
}
