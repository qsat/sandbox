package com.example.idp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponentsBuilder;

/** テスト共通: ログイン → 認可リクエスト → トークンリクエストを MockMvc で通す。 */
final class AuthorizationFlow {

    static final String REDIRECT_URI = "http://127.0.0.1:8080/login/oauth2/code/idp";
    static final String VERIFIER = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

    private AuthorizationFlow() {
    }

    /** フォームログインしてセッションを得る (user() だと auth_time が残らず ID トークンが作れない)。 */
    static MockHttpSession login(MockMvc mvc) throws Exception {
        return (MockHttpSession) mvc.perform(formLogin().user("user").password("password"))
            .andReturn().getRequest().getSession(false);
    }

    /** 同意なしのクライアントでフローを通し、トークンレスポンスの JSON を返す。 */
    static String run(MockMvc mvc) throws Exception {
        MockHttpSession session = login(mvc);
        String location = mvc.perform(get("/oauth2/authorize")
                .session(session)
                .queryParam("response_type", "code")
                .queryParam("client_id", "web-client")
                .queryParam("redirect_uri", REDIRECT_URI)
                .queryParam("scope", "openid profile")
                .queryParam("state", "xyz")
                .queryParam("code_challenge", challenge(VERIFIER))
                .queryParam("code_challenge_method", "S256"))
            .andReturn().getResponse().getRedirectedUrl();
        return exchangeCode(mvc, "web-client", "web-client-secret", location);
    }

    static String exchangeCode(MockMvc mvc, String clientId, String secret, String redirectLocation)
            throws Exception {
        String code = UriComponentsBuilder.fromUriString(redirectLocation).build().getQueryParams().getFirst("code");
        return mvc.perform(post("/oauth2/token")
                .with(httpBasic(clientId, secret))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", REDIRECT_URI)
                .param("code_verifier", VERIFIER))
            .andReturn().getResponse().getContentAsString();
    }

    static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
