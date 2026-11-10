package com.example.idp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;

import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.util.UriComponentsBuilder;

/** 認可コードフローの各ステップをテストから呼ぶための小道具。 */
final class FlowSupport {

    static final String REDIRECT_URI = "http://127.0.0.1:8080/login/oauth2/code/idp";
    static final String VERIFIER = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

    private final MockMvc mvc;

    FlowSupport(MockMvc mvc) {
        this.mvc = mvc;
    }

    /** フォームログインしてセッションを得る。 */
    MockHttpSession login(String username, String password) throws Exception {
        return (MockHttpSession) mvc.perform(formLogin("/login").user(username).password(password))
            .andReturn().getRequest().getSession(false);
    }

    MockHttpServletRequestBuilder authorizeRequest(String scope, String state) throws Exception {
        return get("/oauth2/authorize")
            .accept("text/html")
            .queryParam("response_type", "code")
            .queryParam("client_id", "web-client")
            .queryParam("redirect_uri", REDIRECT_URI)
            .queryParam("scope", scope)
            .queryParam("state", state)
            .queryParam("code_challenge", challenge(VERIFIER))
            .queryParam("code_challenge_method", "S256");
    }

    MvcResult authorize(MockHttpSession session, String scope, String state) throws Exception {
        return mvc.perform(authorizeRequest(scope, state).session(session)).andReturn();
    }

    /** 同意画面からの POST。approvedScopes が空なら「拒否」と同じ送信になる。 */
    MvcResult submitConsent(MockHttpSession session, String state, String... approvedScopes) throws Exception {
        // CSRF トークンは付けない。認可サーバーのエンドポイントは CSRF 検査の対象外で、
        // 同意の POST は「同意用の state」を知っていることで守られる。
        MockHttpServletRequestBuilder request = post("/oauth2/authorize")
            .session(session)
            .param("client_id", "web-client")
            .param("state", state);
        if (approvedScopes.length > 0) {
            request.param("scope", approvedScopes);
        }
        return mvc.perform(request).andReturn();
    }

    /** 同意画面へのリダイレクトから state を取り出す。 */
    static String stateOf(MvcResult result) {
        return queryParam(result.getResponse().getRedirectedUrl(), "state");
    }

    static String queryParam(String url, String name) {
        List<String> values = UriComponentsBuilder.fromUriString(url).build().getQueryParams().get(name);
        return (values == null) ? null : java.net.URLDecoder.decode(values.get(0), StandardCharsets.UTF_8);
    }

    /** 認可コードをトークンに交換して、レスポンスの JSON をそのまま返す。 */
    String exchange(String code) throws Exception {
        return mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "web-client-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", REDIRECT_URI)
                .param("code_verifier", VERIFIER))
            .andReturn().getResponse().getContentAsString();
    }

    /** JWT の payload 部分 (JSON 文字列) を取り出す。署名検証はしない (中身を見るだけ)。 */
    static String payload(String jwt) {
        return new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]), StandardCharsets.UTF_8);
    }

    private static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
