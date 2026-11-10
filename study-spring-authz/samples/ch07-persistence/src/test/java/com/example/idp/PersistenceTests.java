package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.lob.DefaultLobHandler;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.jackson.SecurityJacksonModules;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService.JsonMapperOAuth2AuthorizationParametersMapper;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService.JsonMapperOAuth2AuthorizationRowMapper;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsent;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import com.jayway.jsonpath.JsonPath;

import com.example.idp.seed.DataSeeder;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.jsontype.BasicPolymorphicTypeValidator;

@SpringBootTest
@AutoConfigureMockMvc
class PersistenceTests {

    private static final String REDIRECT_URI = "http://127.0.0.1:8080/login/oauth2/code/idp";
    private static final String DB_URL = "jdbc:h2:mem:ch07-test;DB_CLOSE_DELAY=-1";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired RegisteredClientRepository clients;
    @Autowired OAuth2AuthorizationConsentService consentService;
    @Autowired UserDetailsService userDetailsService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired DataSeeder seeder;

    @Test
    void JDBC実装でも認可コードフローが通りトークンが発行される() throws Exception {
        String tokenResponse = runAuthorizationCodeFlow();

        assertThat(JsonPath.<String>read(tokenResponse, "$.access_token")).isNotBlank();
        assertThat(JsonPath.<String>read(tokenResponse, "$.refresh_token")).isNotBlank();
    }

    @Test
    void フローを通すと認可の行がDBに保存されトークン値がそのまま入っている() throws Exception {
        String tokenResponse = runAuthorizationCodeFlow();
        String accessToken = JsonPath.read(tokenResponse, "$.access_token");
        String refreshToken = JsonPath.read(tokenResponse, "$.refresh_token");

        // BLOB 列は UTF-8 の文字列として読み出す
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT principal_name, authorized_scopes, access_token_type,"
                + " UTF8TOSTRING(access_token_value) AS access_token_value,"
                + " UTF8TOSTRING(refresh_token_value) AS refresh_token_value,"
                + " UTF8TOSTRING(attributes) AS attributes,"
                + " UTF8TOSTRING(access_token_metadata) AS access_token_metadata"
                + " FROM oauth2_authorization WHERE UTF8TOSTRING(refresh_token_value) = ?",
            refreshToken);

        assertThat(row.get("PRINCIPAL_NAME")).isEqualTo("user");
        assertThat(row.get("AUTHORIZED_SCOPES")).isEqualTo("openid,profile");
        assertThat(row.get("ACCESS_TOKEN_TYPE")).isEqualTo("Bearer");
        // トークン値はハッシュ化されず、クライアントに返した値そのものが入っている
        assertThat(row.get("ACCESS_TOKEN_VALUE")).isEqualTo(accessToken);
        assertThat(row.get("REFRESH_TOKEN_VALUE")).isEqualTo(refreshToken);
        // attributes / metadata は型情報 (@class) 付きの JSON
        assertThat((String) row.get("ATTRIBUTES")).startsWith("{\"@class\":\"java.util.Collections$UnmodifiableMap\"");
        assertThat((String) row.get("ACCESS_TOKEN_METADATA")).contains("\"metadata.token.invalidated\":false");
    }

    @Test
    void 再起動相当の別コンテキストから同じリフレッシュトークンで更新できる() throws Exception {
        String first = runAuthorizationCodeFlow();
        String refreshToken = JsonPath.read(first, "$.refresh_token");
        String firstKid = kidOf(JsonPath.read(first, "$.access_token"));

        // 同じ DB を見る 2 つ目のアプリケーション (= 再起動後の IdP) を立ち上げる。1 つ目とは Bean もメモリも共有しない。
        try (ConfigurableApplicationContext restarted = new SpringApplicationBuilder(IdpApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.port=0", "spring.datasource.url=" + DB_URL)
                .run()) {
            int port = ((WebServerApplicationContext) restarted).getWebServer().getPort();
            RestClient client = RestClient.builder().baseUrl("http://localhost:" + port).build();

            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("grant_type", "refresh_token");
            form.add("refresh_token", refreshToken);
            String refreshed = client.post().uri("/oauth2/token")
                .headers(h -> h.setBasicAuth("web-client", "web-client-secret"))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve().body(String.class);

            assertThat(JsonPath.<String>read(refreshed, "$.access_token")).isNotBlank();

            // 署名鍵は起動ごとに作り直されるため、新しい JWT の kid は変わる (鍵の永続化は 5 章)
            String newKid = kidOf(JsonPath.read(refreshed, "$.access_token"));
            assertThat(newKid).isNotEqualTo(firstKid);

            // 起動前に発行した JWT は、新しい鍵では検証できない
            String oldAccessToken = JsonPath.read(first, "$.access_token");
            assertThatThrownBy(() -> client.get().uri("/userinfo")
                    .headers(h -> h.setBearerAuth(oldAccessToken))
                    .retrieve().body(String.class))
                .hasMessageContaining("401");
        }
    }

    @Test
    void 初期データの投入は何度実行しても行が増えない() throws Exception {
        seeder.run(null);
        seeder.run(null);

        Integer clientRows = jdbc.queryForObject(
            "SELECT COUNT(*) FROM oauth2_registered_client WHERE client_id = 'web-client'", Integer.class);
        Integer userRows = jdbc.queryForObject(
            "SELECT COUNT(*) FROM app_user WHERE username = 'user'", Integer.class);
        assertThat(clientRows).isEqualTo(1);
        assertThat(userRows).isEqualTo(1);
    }

    @Test
    void クライアントシークレットとユーザーのパスワードはハッシュで保存される() {
        String clientSecret = jdbc.queryForObject(
            "SELECT client_secret FROM oauth2_registered_client WHERE client_id = 'web-client'", String.class);
        String password = jdbc.queryForObject(
            "SELECT password FROM app_user WHERE username = 'user'", String.class);

        assertThat(clientSecret).startsWith("{bcrypt}").doesNotContain("web-client-secret");
        assertThat(passwordEncoder.matches("web-client-secret", clientSecret)).isTrue();
        assertThat(password).startsWith("{bcrypt}").doesNotContain("password}");
        assertThat(passwordEncoder.matches("password", password)).isTrue();
    }

    @Test
    void ユーザーをDBから読み込める() {
        UserDetails user = userDetailsService.loadUserByUsername("user");

        assertThat(user.getAuthorities()).extracting("authority").containsExactly("ROLE_USER");
        assertThat(user.isEnabled()).isTrue();
        assertThatThrownBy(() -> userDetailsService.loadUserByUsername("nobody"))
            .isInstanceOf(UsernameNotFoundException.class);
    }

    @Test
    void 同意を保存して読み戻せる() {
        RegisteredClient client = clients.findByClientId("web-client");
        OAuth2AuthorizationConsent consent = OAuth2AuthorizationConsent.withId(client.getId(), "consent-user")
            .scope("openid")
            .scope("profile")
            .build();

        consentService.save(consent);

        OAuth2AuthorizationConsent loaded = consentService.findById(client.getId(), "consent-user");
        assertThat(loaded.getScopes()).containsExactlyInAnyOrder("openid", "profile");
        // authorities 列には SCOPE_ 付きのカンマ区切りで入る
        String authorities = jdbc.queryForObject(
            "SELECT authorities FROM oauth2_authorization_consent WHERE principal_name = 'consent-user'",
            String.class);
        assertThat(authorities.split(",")).containsExactlyInAnyOrder("SCOPE_openid", "SCOPE_profile");
    }

    /** 独自の型。final でないクラスは、Jackson に「型名つき」で保存されるため許可リストの対象になる。 */
    public static class TenantInfo {
        private String tenantId;

        public TenantInfo() {
        }

        public TenantInfo(String tenantId) {
            this.tenantId = tenantId;
        }

        public String getTenantId() {
            return tenantId;
        }

        public void setTenantId(String tenantId) {
            this.tenantId = tenantId;
        }
    }

    @Test
    void 独自の型をattributesに入れるには許可リストへの登録が必要() {
        RegisteredClient client = clients.findByClientId("web-client");
        OAuth2Authorization authorization = OAuth2Authorization.withRegisteredClient(client)
            .principalName("user")
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .attribute("tenant", new TenantInfo("t-001"))
            .build();

        // 標準のままだと、保存はできても読み戻せない (許可リストにない型名なので Jackson が拒否する)
        JdbcOAuth2AuthorizationService standard = new JdbcOAuth2AuthorizationService(jdbc, clients);
        standard.save(authorization);
        assertThatThrownBy(() -> standard.findById(authorization.getId()))
            .hasMessageContaining(TenantInfo.class.getName());

        // 許可リストに独自の型を足した JsonMapper を差し替えると読み戻せる
        JsonMapper mapper = JsonMapper.builder()
            .addModules(SecurityJacksonModules.getModules(getClass().getClassLoader(),
                BasicPolymorphicTypeValidator.builder().allowIfSubType(TenantInfo.class)))
            .build();
        JdbcOAuth2AuthorizationService custom = new JdbcOAuth2AuthorizationService(jdbc, clients);
        JsonMapperOAuth2AuthorizationRowMapper rowMapper = new JsonMapperOAuth2AuthorizationRowMapper(clients, mapper);
        rowMapper.setLobHandler(new DefaultLobHandler());
        custom.setAuthorizationRowMapper(rowMapper);
        custom.setAuthorizationParametersMapper(new JsonMapperOAuth2AuthorizationParametersMapper(mapper));

        OAuth2Authorization loaded = custom.findById(authorization.getId());
        TenantInfo tenant = loaded.getAttribute("tenant");
        assertThat(tenant.getTenantId()).isEqualTo("t-001");
    }

    // ---- ヘルパー ----

    /** ログイン → 認可リクエスト → トークンリクエストを MockMvc で通し、トークンレスポンスの JSON を返す。 */
    private String runAuthorizationCodeFlow() throws Exception {
        String verifier = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";
        MockHttpSession session = (MockHttpSession) mvc.perform(formLogin().user("user").password("password"))
            .andReturn().getRequest().getSession(false);

        String location = mvc.perform(get("/oauth2/authorize")
                .session(session)
                .queryParam("response_type", "code")
                .queryParam("client_id", "web-client")
                .queryParam("redirect_uri", REDIRECT_URI)
                .queryParam("scope", "openid profile")
                .queryParam("state", "xyz")
                .queryParam("code_challenge", challenge(verifier))
                .queryParam("code_challenge_method", "S256"))
            .andReturn().getResponse().getRedirectedUrl();
        String code = UriComponentsBuilder.fromUriString(location).build().getQueryParams().getFirst("code");

        return mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "web-client-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", REDIRECT_URI)
                .param("code_verifier", verifier))
            .andReturn().getResponse().getContentAsString();
    }

    private static String kidOf(String jwt) {
        String header = new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[0]), StandardCharsets.UTF_8);
        return JsonPath.read(header, "$.kid");
    }

    private static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
