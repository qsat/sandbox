package com.example.idp;

import static com.example.idp.FlowSupport.SPA_REDIRECT;
import static com.example.idp.FlowSupport.VERIFIER;
import static com.example.idp.FlowSupport.WEB_REDIRECT;
import static com.example.idp.FlowSupport.authorizeRequest;
import static com.example.idp.FlowSupport.obtainCode;
import static com.example.idp.FlowSupport.queryParam;
import static com.example.idp.FlowSupport.s256;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 正常系: 認可コードフロー、public client、リフレッシュ、IdP 内部の状態遷移。 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthorizationCodeFlowTests {

    private static final OAuth2TokenType CODE = new OAuth2TokenType("code");

    @Autowired
    MockMvc mvc;

    @Autowired
    OAuth2AuthorizationService authorizationService;

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void RFC7636付録Bの例でS256のチャレンジが計算できる() {
        assertThat(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
            .isEqualTo("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    @Test
    void 認可リクエストの結果は302でcodeとstateがredirect_uriに付く() throws Exception {
        MockHttpSession session = FlowSupport.login(mvc);

        MvcResult result = mvc.perform(authorizeRequest(session, "web-client", WEB_REDIRECT, "openid profile",
            s256(VERIFIER))).andExpect(status().isFound()).andReturn();

        String location = result.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(WEB_REDIRECT + "?code=");
        assertThat(queryParam(location, "state")).isEqualTo("xyz");
    }

    @Test
    void 認可リクエストからトークン発行までOAuth2Authorizationの中身が遷移する() throws Exception {
        MockHttpSession session = FlowSupport.login(mvc);
        String code = obtainCode(mvc, session, "web-client", WEB_REDIRECT);

        // 状態1: コード発行直後。認可リクエストの内容とコードだけが入っていて、トークンはまだ無い
        OAuth2Authorization issued = authorizationService.findByToken(code, CODE);
        assertThat(issued.getPrincipalName()).isEqualTo("user");
        assertThat(issued.getAuthorizedScopes()).containsExactlyInAnyOrder("openid", "profile");
        assertThat(issued.getAccessToken()).isNull();
        assertThat(issued.getRefreshToken()).isNull();
        assertThat(issued.getToken(OidcIdToken.class)).isNull();

        OAuth2AuthorizationRequest saved = issued.getAttribute(OAuth2AuthorizationRequest.class.getName());
        assertThat(saved.getState()).isEqualTo("xyz");
        assertThat(saved.getRedirectUri()).isEqualTo(WEB_REDIRECT);
        assertThat(saved.getAdditionalParameters())
            .containsEntry("code_challenge", s256(VERIFIER))
            .containsEntry("code_challenge_method", "S256")
            .containsEntry("nonce", "n-0S6_WzA2Mj");

        OAuth2Authorization.Token<OAuth2AuthorizationCode> codeToken = issued.getToken(OAuth2AuthorizationCode.class);
        assertThat(codeToken.isInvalidated()).isFalse();
        // 認可コードの有効期限は既定で 5 分
        assertThat(Duration.between(codeToken.getToken().getIssuedAt(), codeToken.getToken().getExpiresAt()))
            .isEqualTo(Duration.ofMinutes(5));

        // 状態2: トークン発行後。同じ OAuth2Authorization にトークンが足され、コードは使用済みになる
        exchange("web-client", "web-client-secret", code, WEB_REDIRECT).andExpect(status().isOk());

        OAuth2Authorization completed = authorizationService.findByToken(code, CODE);
        assertThat(completed.getId()).isEqualTo(issued.getId());
        assertThat(completed.getToken(OAuth2AuthorizationCode.class).isInvalidated()).isTrue();
        assertThat(completed.getAccessToken().isActive()).isTrue();
        assertThat(completed.getRefreshToken().isActive()).isTrue();
        assertThat(completed.getToken(OidcIdToken.class)).isNotNull();
    }

    @Test
    void 認可コードフローでconfidentialクライアントはclient_secret_basicでトークンを取得できる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        exchange("web-client", "web-client-secret", code, WEB_REDIRECT)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token_type").value("Bearer"))
            .andExpect(jsonPath("$.expires_in").value(299))
            .andExpect(jsonPath("$.scope").value("openid profile"))
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.refresh_token").isNotEmpty())
            .andExpect(jsonPath("$.id_token").isNotEmpty());
    }

    @Test
    void publicクライアントはclient_secretなしでclient_idとcode_verifierだけでトークンを取得できる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "spa-client", SPA_REDIRECT);

        mvc.perform(post("/oauth2/token")
                .param("client_id", "spa-client")
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", SPA_REDIRECT)
                .param("code_verifier", VERIFIER))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.id_token").isNotEmpty());
    }

    @Test
    void publicクライアントにはREFRESH_TOKENを登録していてもリフレッシュトークンは発行されない() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "spa-client", SPA_REDIRECT);

        MvcResult result = mvc.perform(post("/oauth2/token")
                .param("client_id", "spa-client")
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", SPA_REDIRECT)
                .param("code_verifier", VERIFIER))
            .andExpect(status().isOk())
            .andReturn();

        JsonNode body = json.readTree(result.getResponse().getContentAsString());
        assertThat(body.has("refresh_token")).isFalse();
        assertThat(authorizationService.findByToken(code, CODE).getRefreshToken()).isNull();
    }

    @Test
    void リフレッシュトークンで新しいアクセストークンを取得できる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);
        MvcResult first = exchange("web-client", "web-client-secret", code, WEB_REDIRECT).andReturn();
        JsonNode firstBody = json.readTree(first.getResponse().getContentAsString());
        String refreshToken = firstBody.get("refresh_token").asText();

        MvcResult refreshed = mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "web-client-secret"))
                .param("grant_type", "refresh_token")
                .param("refresh_token", refreshToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.scope").value("openid profile"))
            .andReturn();

        JsonNode body = json.readTree(refreshed.getResponse().getContentAsString());
        assertThat(body.get("access_token").asText()).isNotEqualTo(firstBody.get("access_token").asText());
        // 既定の reuseRefreshTokens=true なので、リフレッシュトークンは入れ替わらず同じ値が返る
        assertThat(body.get("refresh_token").asText()).isEqualTo(refreshToken);
    }

    @Test
    void 有効期限が切れた認可コードは交換できない() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        // 5 分待つ代わりに、保存済みの認可コードを「すでに期限切れのもの」に差し替える
        OAuth2Authorization authorization = authorizationService.findByToken(code, CODE);
        Instant past = Instant.now().minus(Duration.ofMinutes(10));
        OAuth2AuthorizationCode expired = new OAuth2AuthorizationCode(code, past, past.plus(Duration.ofMinutes(5)));
        authorizationService.save(OAuth2Authorization.from(authorization).token(expired).build());

        exchange("web-client", "web-client-secret", code, WEB_REDIRECT)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    /** confidential client として認可コードをトークンに交換する。 */
    private org.springframework.test.web.servlet.ResultActions exchange(String clientId, String secret, String code,
            String redirectUri) throws Exception {
        return mvc.perform(post("/oauth2/token")
            .with(httpBasic(clientId, secret))
            .param("grant_type", "authorization_code")
            .param("code", code)
            .param("redirect_uri", redirectUri)
            .param("code_verifier", VERIFIER));
    }
}
