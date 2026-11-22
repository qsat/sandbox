package com.example.idp;

import static com.example.idp.FlowSupport.SPA;
import static com.example.idp.FlowSupport.SPA_REDIRECT;
import static com.example.idp.FlowSupport.VERIFIER;
import static com.example.idp.FlowSupport.WEB;
import static com.example.idp.FlowSupport.WEB_REDIRECT;
import static com.example.idp.FlowSupport.WEB_SECRET;
import static com.example.idp.FlowSupport.queryParam;
import static com.example.idp.FlowSupport.s256;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;

import com.jayway.jsonpath.JsonPath;

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

/** 4 章: 認可コードフローの正常系 (PKCE、public client、リフレッシュ、IdP 内部の状態遷移)。保管先は JDBC。 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthorizationCodeFlowTests {

    private static final OAuth2TokenType CODE = new OAuth2TokenType("code");

    @Autowired
    MockMvc mvc;

    @Autowired
    OAuth2AuthorizationService authorizationService;

    @Test
    void RFC7636付録Bの例でS256のチャレンジが計算できる() {
        assertThat(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
            .isEqualTo("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    @Test
    void publicクライアントは同意なしでコードが出てclient_secretなしでトークンを取得できる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        MockHttpSession session = flow.loginAlice();

        // spa-client は同意画面を出さない設定なので、認可リクエストの結果がそのままコードの発行になる
        MvcResult result = flow.authorize(session, SPA, SPA_REDIRECT, "openid profile api.read", "xyz");
        String location = result.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(SPA_REDIRECT + "?code=");
        assertThat(queryParam(location, "state")).isEqualTo("xyz");

        flow.exchangeSpa(queryParam(location, "code"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.id_token").isNotEmpty())
            .andExpect(jsonPath("$.scope").value("openid profile api.read"));
    }

    @Test
    void publicクライアントにはREFRESH_TOKENを登録していてもリフレッシュトークンは発行されない() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String code = flow.obtainCode(flow.loginAlice(), SPA, SPA_REDIRECT);

        String body = flow.exchangeSpa(code).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.parse(body).read("$", java.util.Map.class)).doesNotContainKey("refresh_token");
        assertThat(authorizationService.findByToken(code, CODE).getRefreshToken()).isNull();
    }

    @Test
    void 認可リクエストからトークン発行までOAuth2Authorizationの中身が遷移する() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String code = flow.obtainCode(flow.loginAlice(), WEB, WEB_REDIRECT);

        // 状態1: コード発行直後。認可リクエストの内容とコードだけが入っていて、トークンはまだ無い
        OAuth2Authorization issued = authorizationService.findByToken(code, CODE);
        assertThat(issued.getPrincipalName()).isEqualTo("alice");
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
        // 認可コードの有効期限は ClientRegistrations で 2 分にしている (既定は 5 分)
        assertThat(Duration.between(codeToken.getToken().getIssuedAt(), codeToken.getToken().getExpiresAt()))
            .isEqualTo(Duration.ofMinutes(2));

        // 状態2: トークン発行後。同じ OAuth2Authorization にトークンが足され、コードは使用済みになる
        flow.exchangeWeb(code, VERIFIER).andExpect(status().isOk());

        OAuth2Authorization completed = authorizationService.findByToken(code, CODE);
        assertThat(completed.getId()).isEqualTo(issued.getId());
        assertThat(completed.getToken(OAuth2AuthorizationCode.class).isInvalidated()).isTrue();
        assertThat(completed.getAccessToken().isActive()).isTrue();
        assertThat(completed.getRefreshToken().isActive()).isTrue();
        assertThat(completed.getToken(OidcIdToken.class)).isNotNull();
    }

    @Test
    void リフレッシュトークンで新しいアクセストークンを取得でき_リフレッシュトークンも入れ替わる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String code = flow.obtainCode(flow.loginAlice(), WEB, WEB_REDIRECT);
        String first = flow.exchangeWeb(code, VERIFIER).andReturn().getResponse().getContentAsString();
        String refreshToken = JsonPath.read(first, "$.refresh_token");

        String refreshed = flow.refresh(WEB, WEB_SECRET, refreshToken, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.scope").value("openid profile"))
            .andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.<String>read(refreshed, "$.access_token"))
            .isNotEqualTo(JsonPath.<String>read(first, "$.access_token"));
        // reuseRefreshTokens(false) なので、更新のたびに新しいリフレッシュトークンになる (5 章)
        assertThat(JsonPath.<String>read(refreshed, "$.refresh_token")).isNotEqualTo(refreshToken);
    }

    @Test
    void リフレッシュ時に元より狭いscopeを要求するとそのscopeだけになる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String refreshToken = flow.issueWebTokens("openid profile").get("refresh_token").toString();

        flow.refresh(WEB, WEB_SECRET, refreshToken, "openid")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.scope").value("openid"));
    }

    @Test
    void リフレッシュ時に元より広いscopeを要求するとinvalid_scopeになる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String refreshToken = flow.issueWebTokens("openid profile").get("refresh_token").toString();

        // email は web-client に登録された scope だが、「元の認可に含まれない」ので拒否される
        flow.refresh(WEB, WEB_SECRET, refreshToken, "openid profile email")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_scope"));
    }

    @Test
    void 有効期限が切れた認可コードは交換できない() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String code = flow.obtainCode(flow.loginAlice(), WEB, WEB_REDIRECT);

        // 2 分待つ代わりに、保存済みの認可コードを「すでに期限切れのもの」に差し替える
        OAuth2Authorization authorization = authorizationService.findByToken(code, CODE);
        Instant past = Instant.now().minus(Duration.ofMinutes(10));
        OAuth2AuthorizationCode expired = new OAuth2AuthorizationCode(code, past, past.plus(Duration.ofMinutes(2)));
        authorizationService.save(OAuth2Authorization.from(authorization).token(expired).build());

        flow.exchangeWeb(code, VERIFIER)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
    }
}
