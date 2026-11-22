package com.example.idp;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import com.jayway.jsonpath.JsonPath;

import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * 認可コードフローの各ステップをテストから呼ぶための小道具 (4・5・6 章のテストの小道具を 1 つにまとめた)。
 *
 * <p>MockMvc で通すときの注意:
 * <ul>
 *   <li>認証は user() で差し込まず、フォームログインする (差し込むと auth_time が残らず ID トークンが作れない)</li>
 *   <li>web-client は同意が必要。{@link #obtainCode} は、同意画面に飛ばされたら承認して先へ進む</li>
 * </ul>
 */
final class FlowSupport {

    static final String WEB = "web-client";
    static final String WEB_SECRET = "web-client-secret";
    static final String SPA = "spa-client";
    static final String WEB_REDIRECT = "http://127.0.0.1:8080/login/oauth2/code/idp";
    static final String SPA_REDIRECT = "http://127.0.0.1:5173/callback";

    /** RFC 7636 の code_verifier は 43〜128 文字。学習用の固定値 (本番では毎回ランダムに作る)。 */
    static final String VERIFIER = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

    private final MockMvc mvc;

    FlowSupport(MockMvc mvc) {
        this.mvc = mvc;
    }

    // ---------------------------------------------------------------- ログイン

    MockHttpSession login(String username, String password) throws Exception {
        return (MockHttpSession) mvc.perform(formLogin("/login").user(username).password(password))
            .andReturn().getRequest().getSession(false);
    }

    MockHttpSession loginAlice() throws Exception {
        return login("alice", "password");
    }

    // ---------------------------------------------------------------- 認可リクエスト

    /** 認可リクエストを組み立てる。session が null なら未ログイン。codeChallenge が null なら PKCE のパラメーターを付けない。 */
    MockHttpServletRequestBuilder authorizeRequest(MockHttpSession session, String clientId, String redirectUri,
            String scope, String state, String codeChallenge) {
        MockHttpServletRequestBuilder request = get("/oauth2/authorize")
            .accept("text/html")
            .queryParam("response_type", "code")
            .queryParam("client_id", clientId)
            .queryParam("redirect_uri", redirectUri)
            .queryParam("scope", scope)
            .queryParam("state", state)
            .queryParam("nonce", "n-0S6_WzA2Mj");
        if (session != null) {
            request.session(session);
        }
        if (codeChallenge != null) {
            request.queryParam("code_challenge", codeChallenge).queryParam("code_challenge_method", "S256");
        }
        return request;
    }

    MvcResult authorize(MockHttpSession session, String clientId, String redirectUri, String scope, String state)
            throws Exception {
        return mvc.perform(authorizeRequest(session, clientId, redirectUri, scope, state, s256(VERIFIER)))
            .andReturn();
    }

    /** web-client への認可リクエスト (PKCE 付き、ログイン済みの session で)。 */
    MvcResult authorizeWeb(MockHttpSession session, String scope, String state) throws Exception {
        return authorize(session, WEB, WEB_REDIRECT, scope, state);
    }

    /** 同意画面へのリダイレクトから state (認可サーバーが発行した、同意リクエストを特定する値) を取り出す。 */
    static String stateOf(MvcResult result) {
        return queryParam(result.getResponse().getRedirectedUrl(), "state");
    }

    /** 同意画面からの POST。approvedScopes が空なら「拒否」と同じ送信になる。 */
    MvcResult submitConsent(MockHttpSession session, String clientId, String state, String... approvedScopes)
            throws Exception {
        // CSRF トークンは付けない。認可サーバーのエンドポイントは CSRF 検査の対象外で、
        // 同意の POST は「同意用の state」を知っていることで守られる。
        MockHttpServletRequestBuilder request = post("/oauth2/authorize")
            .session(session)
            .param("client_id", clientId)
            .param("state", state);
        if (approvedScopes.length > 0) {
            request.param("scope", approvedScopes);
        }
        return mvc.perform(request).andReturn();
    }

    /**
     * 認可リクエストを送って認可コードを得る。同意画面に飛ばされたら、openid 以外の scope を全部承認する。
     */
    String obtainCode(MockHttpSession session, String clientId, String redirectUri, String scope) throws Exception {
        MvcResult result = authorize(session, clientId, redirectUri, scope, "xyz");
        String location = result.getResponse().getRedirectedUrl();
        if (location.contains("/oauth2/consent")) {
            String[] approve = Arrays.stream(scope.split(" ")).filter(s -> !s.equals("openid")).toArray(String[]::new);
            location = submitConsent(session, clientId, queryParam(location, "state"), approve)
                .getResponse().getRedirectedUrl();
        }
        return queryParam(location, "code");
    }

    String obtainCode(MockHttpSession session, String clientId, String redirectUri) throws Exception {
        return obtainCode(session, clientId, redirectUri, "openid profile");
    }

    // ---------------------------------------------------------------- トークンリクエスト

    /** confidential client として認可コードをトークンに交換する。 */
    ResultActions exchange(String clientId, String secret, String code, String redirectUri, String verifier)
            throws Exception {
        return mvc.perform(post("/oauth2/token")
            .with(httpBasic(clientId, secret))
            .param("grant_type", "authorization_code")
            .param("code", code)
            .param("redirect_uri", redirectUri)
            .param("code_verifier", verifier));
    }

    ResultActions exchangeWeb(String code, String verifier) throws Exception {
        return exchange(WEB, WEB_SECRET, code, WEB_REDIRECT, verifier);
    }

    /** 認可コードを web-client としてトークンに交換して、レスポンスの JSON をそのまま返す。 */
    String exchangeWebBody(String code) throws Exception {
        return exchangeWeb(code, VERIFIER).andReturn().getResponse().getContentAsString();
    }

    /** public client として認可コードをトークンに交換する (client_secret なし)。 */
    ResultActions exchangeSpa(String code) throws Exception {
        return mvc.perform(post("/oauth2/token")
            .param("client_id", SPA)
            .param("grant_type", "authorization_code")
            .param("code", code)
            .param("redirect_uri", SPA_REDIRECT)
            .param("code_verifier", VERIFIER));
    }

    ResultActions refresh(String clientId, String secret, String refreshToken, String scope) throws Exception {
        var request = post("/oauth2/token")
            .with(httpBasic(clientId, secret))
            .param("grant_type", "refresh_token")
            .param("refresh_token", refreshToken);
        if (scope != null) {
            request.param("scope", scope);
        }
        return mvc.perform(request);
    }

    /** ログイン → (同意) → コード交換までを通して、トークンレスポンスの JSON を Map で返す (web-client)。 */
    Map<String, Object> issueWebTokens(String scope) throws Exception {
        String code = obtainCode(loginAlice(), WEB, WEB_REDIRECT, scope);
        String body = exchangeWeb(code, VERIFIER).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$");
    }

    // ---------------------------------------------------------------- 値の取り出し

    /** RFC 7636 の S256: BASE64URL(SHA256(ASCII(code_verifier))) (パディング無し)。 */
    static String s256(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        }
        catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    static String queryParam(String url, String name) {
        List<String> values = UriComponentsBuilder.fromUriString(url).build().getQueryParams().get(name);
        // クエリ文字列は URL エンコードされているので、デコードして返す
        return (values == null) ? null : URLDecoder.decode(values.get(0), StandardCharsets.UTF_8);
    }

    /** JWT の payload 部分 (JSON 文字列) を取り出す。署名検証はしない (中身を見るだけ)。 */
    static String payload(String jwt) {
        return new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]), StandardCharsets.UTF_8);
    }
}
