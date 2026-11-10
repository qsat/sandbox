package com.example.idp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.util.UriComponentsBuilder;

/** 4 章のテストが共通で使う、認可コードフローの下ごしらえ。 */
final class FlowSupport {

    static final String WEB_REDIRECT = "http://127.0.0.1:8080/login/oauth2/code/idp";
    static final String SPA_REDIRECT = "http://127.0.0.1:5173/callback";

    /** RFC 7636 の code_verifier は 43〜128 文字。学習用の固定値 (本番では毎回ランダムに作る)。 */
    static final String VERIFIER = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

    private FlowSupport() {
    }

    /** RFC 7636 の S256: BASE64URL(SHA256(ASCII(code_verifier))) (パディング無し)。 */
    static String s256(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        }
        catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /**
     * フォームログインしてセッションを得る。
     * user() で認証を差し込むと auth_time が作れず ID トークン生成に失敗するので、実際にログインする。
     */
    static MockHttpSession login(MockMvc mvc) throws Exception {
        return (MockHttpSession) mvc.perform(formLogin().user("user").password("password"))
            .andReturn().getRequest().getSession(false);
    }

    /** 認可リクエストを組み立てる。session が null なら未ログイン。codeChallenge が null なら PKCE のパラメーターを付けない。 */
    static MockHttpServletRequestBuilder authorizeRequest(MockHttpSession session, String clientId,
            String redirectUri, String scope, String codeChallenge) {
        MockHttpServletRequestBuilder request = get("/oauth2/authorize")
            .queryParam("response_type", "code")
            .queryParam("client_id", clientId)
            .queryParam("redirect_uri", redirectUri)
            .queryParam("scope", scope)
            .queryParam("state", "xyz")
            .queryParam("nonce", "n-0S6_WzA2Mj");
        if (session != null) {
            request.session(session);
        }
        if (codeChallenge != null) {
            request.queryParam("code_challenge", codeChallenge).queryParam("code_challenge_method", "S256");
        }
        return request;
    }

    /** 認可リクエストを送り、Location ヘッダーの code を取り出す。 */
    static String obtainCode(MockMvc mvc, MockHttpSession session, String clientId, String redirectUri)
            throws Exception {
        MvcResult result = mvc.perform(authorizeRequest(session, clientId, redirectUri, "openid profile",
            s256(VERIFIER))).andReturn();
        return queryParam(result.getResponse().getRedirectedUrl(), "code");
    }

    static String queryParam(String url, String name) {
        // クエリ文字列は URL エンコードされているので、デコードして返す
        String value = UriComponentsBuilder.fromUriString(url).build().getQueryParams().getFirst(name);
        return value == null ? null : java.net.URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
