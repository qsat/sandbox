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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/** 異常系: 何が・なぜ拒否され、どの形で返るか。 */
@SpringBootTest
@AutoConfigureMockMvc
class FailureCaseTests {

    private static final OAuth2TokenType CODE = new OAuth2TokenType("code");
    private static final String WRONG_VERIFIER = "wrong-verifier-wrong-verifier-wrong-verifier-wrong";

    @Autowired
    MockMvc mvc;

    @Autowired
    OAuth2AuthorizationService authorizationService;

    // ---- 認可エンドポイント (ブラウザ経由) のエラー ----

    @Test
    void 登録外のredirect_uriはリダイレクトせずIdPが400を返す() throws Exception {
        // MockMvc はエラーページ (/error) への内部転送を行わないので、ここで確かめられるのは「400 で Location が無い」まで。
        // エラーページが実際に描画されるかどうか (ログイン状態による違い) は ErrorPageDispatchTests で確かめる
        MvcResult result = mvc.perform(authorizeRequest(FlowSupport.login(mvc), "web-client",
                "http://evil.example/cb", "openid", s256(VERIFIER)))
            .andExpect(status().isBadRequest())
            .andReturn();

        // 検証できない redirect_uri へエラーを返すと、攻撃者の URL への誘導 (オープンリダイレクト) になる
        assertThat(result.getResponse().getRedirectedUrl()).isNull();
    }

    @Test
    void redirect_uriは前方一致や末尾スラッシュの違いでも拒否される() throws Exception {
        MockHttpSession session = FlowSupport.login(mvc);
        for (String uri : new String[] { WEB_REDIRECT + "/", WEB_REDIRECT + "?x=1", "http://127.0.0.1:8080/login" }) {
            mvc.perform(authorizeRequest(session, "web-client", uri, "openid", s256(VERIFIER)))
                .andExpect(status().isBadRequest());
        }
    }

    @Test
    void 未登録のclient_idもリダイレクトせずエラーになる() throws Exception {
        mvc.perform(authorizeRequest(FlowSupport.login(mvc), "no-such-client", WEB_REDIRECT, "openid",
                s256(VERIFIER)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void 登録されていないscopeはredirect_uriへerrorパラメーター付きで返る() throws Exception {
        MvcResult result = mvc.perform(authorizeRequest(FlowSupport.login(mvc), "web-client", WEB_REDIRECT,
                "openid admin", s256(VERIFIER)))
            .andExpect(status().isFound())
            .andReturn();

        String location = result.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(WEB_REDIRECT + "?error=invalid_scope");
        assertThat(queryParam(location, "state")).isEqualTo("xyz");
    }

    @Test
    void PKCE必須のクライアントでcode_challengeが無いとinvalid_requestで返る() throws Exception {
        MockHttpSession session = FlowSupport.login(mvc);
        // confidential (requireProofKey=true) も public もどちらも拒否される
        for (String[] client : new String[][] { { "web-client", WEB_REDIRECT }, { "spa-client", SPA_REDIRECT } }) {
            MvcResult result = mvc.perform(authorizeRequest(session, client[0], client[1], "openid", null))
                .andExpect(status().isFound())
                .andReturn();

            String location = result.getResponse().getRedirectedUrl();
            assertThat(location).startsWith(client[1] + "?error=invalid_request");
            assertThat(queryParam(location, "error_description")).isEqualTo("OAuth 2.0 Parameter: code_challenge");
        }
    }

    @Test
    void code_challenge_methodがplainだと拒否される() throws Exception {
        MvcResult result = mvc.perform(authorizeRequest(FlowSupport.login(mvc), "web-client", WEB_REDIRECT,
                "openid", null)
                .queryParam("code_challenge", VERIFIER)
                .queryParam("code_challenge_method", "plain"))
            .andExpect(status().isFound())
            .andReturn();

        assertThat(result.getResponse().getRedirectedUrl()).startsWith(WEB_REDIRECT + "?error=invalid_request");
        assertThat(queryParam(result.getResponse().getRedirectedUrl(), "error_description"))
            .isEqualTo("OAuth 2.0 Parameter: code_challenge_method");
    }

    // ---- トークンエンドポイント (クライアントから直接) のエラー ----

    @Test
    void code_verifierが一致しないとinvalid_grantになる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        exchange(code, WRONG_VERIFIER)
            .andExpect(status().isBadRequest())
            .andExpect(content().json("{\"error\":\"invalid_grant\"}", true));
    }

    @Test
    void code_verifierを間違えても認可コードは消費されず正しい値で再挑戦できる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        exchange(code, WRONG_VERIFIER).andExpect(status().isBadRequest());
        assertThat(authorizationService.findByToken(code, CODE).getToken(OAuth2AuthorizationCode.class)
            .isInvalidated()).isFalse();

        // 攻撃者が推測を繰り返しても、正しい verifier を知らない限り通らない。正規のクライアントは影響を受けない
        exchange(code, VERIFIER).andExpect(status().isOk());
    }

    @Test
    void publicクライアントがcode_verifierを付けないとクライアント認証の時点で拒否される() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "spa-client", SPA_REDIRECT);

        // public client は code_verifier の有無でクライアントを識別する。
        // 無いとクライアント認証のコンバーターが対象外と判断し、未認証のリクエストとして扱われる
        // (Accept: application/json なら 401。ブラウザ向け Accept だとログイン画面へのリダイレクトになる)
        mvc.perform(post("/oauth2/token")
                .accept("application/json")
                .param("client_id", "spa-client")
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", SPA_REDIRECT))
            .andExpect(status().isUnauthorized());

        assertThat(authorizationService.findByToken(code, CODE).getAccessToken()).isNull();
    }

    @Test
    void トークンリクエストのredirect_uriが認可リクエストと違うとinvalid_grantになる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "web-client-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", "http://127.0.0.1:8080/other")
                .param("code_verifier", VERIFIER))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    @Test
    void client_secretが違うと401のinvalid_clientになる() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "wrong-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", WEB_REDIRECT)
                .param("code_verifier", VERIFIER))
            .andExpect(status().isUnauthorized())
            .andExpect(content().json("{\"error\":\"invalid_client\"}", true));
    }

    @Test
    void publicクライアントがclient_secretを送っても認証方式がNONEなので拒否される() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "spa-client", SPA_REDIRECT);

        mvc.perform(post("/oauth2/token")
                .with(httpBasic("spa-client", "any-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", SPA_REDIRECT)
                .param("code_verifier", VERIFIER))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_client"));
    }

    @Test
    void 認可コードを別のクライアントが使おうとするとinvalid_grantになりコードも無効化される() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);

        // spa-client が web-client 宛てのコードを横取りして使おうとした場合
        mvc.perform(post("/oauth2/token")
                .param("client_id", "spa-client")
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", WEB_REDIRECT)
                .param("code_verifier", VERIFIER))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));

        assertThat(authorizationService.findByToken(code, CODE).getToken(OAuth2AuthorizationCode.class)
            .isInvalidated()).isTrue();
        // 正規のクライアントももう使えない (コードが漏れた疑いがあるため安全側に倒す)
        exchange(code, VERIFIER).andExpect(status().isBadRequest());
    }

    @Test
    void 認可コードの再利用は拒否され発行済みのトークンも無効化される() throws Exception {
        String code = obtainCode(mvc, FlowSupport.login(mvc), "web-client", WEB_REDIRECT);
        exchange(code, VERIFIER).andExpect(status().isOk());

        OAuth2Authorization before = authorizationService.findByToken(code, CODE);
        assertThat(before.getAccessToken().isInvalidated()).isFalse();
        assertThat(before.getRefreshToken().isInvalidated()).isFalse();

        // 2 回目。同じコードでトークンを取りに来たのが正規のクライアントか攻撃者かは区別できない
        exchange(code, VERIFIER)
            .andExpect(status().isBadRequest())
            .andExpect(content().json("{\"error\":\"invalid_grant\"}", true));

        OAuth2Authorization after = authorizationService.findByToken(code, CODE);
        assertThat(after.getRefreshToken().isInvalidated()).isTrue();
        assertThat(after.getAccessToken().isInvalidated()).isTrue();
    }

    @Test
    void 存在しない認可コードはinvalid_grantになる() throws Exception {
        exchange("no-such-code", VERIFIER)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    private ResultActions exchange(String code, String verifier) throws Exception {
        return mvc.perform(post("/oauth2/token")
            .with(httpBasic("web-client", "web-client-secret"))
            .param("grant_type", "authorization_code")
            .param("code", code)
            .param("redirect_uri", WEB_REDIRECT)
            .param("code_verifier", verifier));
    }
}
