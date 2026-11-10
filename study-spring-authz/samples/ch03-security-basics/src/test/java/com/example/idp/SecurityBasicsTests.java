package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import jakarta.servlet.Filter;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.example.idp.learn.FilterChainInspector;

/**
 * 第3章: Spring Security の挙動を固定するテスト。
 *
 * <p>どのテストも、本文で説明した仕組み (フィルターチェーン / SecurityContext とセッション /
 * 未認証時の流れ / CSRF / 認可) を実物で確かめている。
 */
@SpringBootTest
@AutoConfigureMockMvc
class SecurityBasicsTests {

    /** SecurityContext が入る HttpSession の属性名 (値は "SPRING_SECURITY_CONTEXT")。 */
    private static final String CONTEXT_ATTR = HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY;
    /** 未認証で来たリクエストを覚えておく属性名。HttpSessionRequestCache の定数は非公開なので文字列で書く。 */
    private static final String SAVED_REQUEST_ATTR = "SPRING_SECURITY_SAVED_REQUEST";

    @Autowired
    MockMvc mvc;

    @Autowired
    FilterChainProxy filterChainProxy;

    @Autowired
    FilterChainInspector inspector;

    // ---- フィルターチェーン ----

    @Test
    void SecurityFilterChainは2本あり認可サーバー用が先に並ぶ() {
        var chains = inspector.describe();

        assertThat(chains).hasSize(2);
        assertThat(chains.get(0).matcher()).contains("AuthorizationServerConfigurer");
        assertThat(chains.get(1).matcher()).isEqualTo("any request");
    }

    @Test
    void 認可サーバー用チェーンにだけプロトコル用フィルターが入っている() {
        var protocol = inspector.describe().get(0).filters();
        var login = inspector.describe().get(1).filters();

        assertThat(protocol).contains("OAuth2AuthorizationEndpointFilter", "OAuth2TokenEndpointFilter",
            "OAuth2ClientAuthenticationFilter", "NimbusJwkSetEndpointFilter");
        assertThat(protocol).doesNotContain("UsernamePasswordAuthenticationFilter");

        assertThat(login).contains("UsernamePasswordAuthenticationFilter", "DefaultLoginPageGeneratingFilter");
        assertThat(login).noneMatch(name -> name.startsWith("OAuth2"));
    }

    @Test
    void どちらのチェーンでもセキュリティの要になるフィルターは同じ順序で並ぶ() {
        for (var chain : inspector.describe()) {
            var filters = chain.filters();
            assertThat(filters.indexOf("SecurityContextHolderFilter"))
                .isLessThan(filters.indexOf("CsrfFilter"));
            assertThat(filters.indexOf("CsrfFilter"))
                .isLessThan(filters.indexOf("ExceptionTranslationFilter"));
            // ExceptionTranslationFilter は AuthorizationFilter の「直前」にある (投げられた例外を受け止めるため)
            assertThat(filters.indexOf("ExceptionTranslationFilter") + 1)
                .isEqualTo(filters.indexOf("AuthorizationFilter"));
        }
    }

    @Test
    void リクエストのURLによって別のチェーンが選ばれる() {
        // FilterChainProxy は登録順 (@Order 順) に matcher を試し、最初に合ったチェーンを使う
        assertThat(filterNames("/oauth2/jwks")).isEqualTo(inspector.describe().get(0).filters());
        assertThat(filterNames("/.well-known/openid-configuration")).isEqualTo(inspector.describe().get(0).filters());
        assertThat(filterNames("/login")).isEqualTo(inspector.describe().get(1).filters());
        assertThat(filterNames("/learn/security-context")).isEqualTo(inspector.describe().get(1).filters());
    }

    private List<String> filterNames(String url) {
        return filterChainProxy.getFilters(url).stream()
            .map(Filter::getClass).map(Class::getSimpleName).toList();
    }

    // ---- 認証のモデルと SecurityContext ----

    @Test
    void 未ログインのAuthenticationはAnonymousAuthenticationTokenでセッションも作られない() throws Exception {
        mvc.perform(get("/learn/security-context"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authentication.type").value("AnonymousAuthenticationToken"))
            .andExpect(jsonPath("$.authentication.name").value("anonymousUser"))
            .andExpect(jsonPath("$.authentication.authorities[0]").value("ROLE_ANONYMOUS"))
            .andExpect(jsonPath("$.session.exists").value(false));
    }

    @Test
    void ログインするとSecurityContextがHttpSessionのSPRING_SECURITY_CONTEXT属性に入る() throws Exception {
        MockHttpSession session = new MockHttpSession();
        login(session, "user").andExpect(status().is3xxRedirection());

        // セッションに入っているのは Authentication そのものではなく SecurityContext
        SecurityContext stored = (SecurityContext) session.getAttribute(CONTEXT_ATTR);
        assertThat(stored).isNotNull();
        assertThat(stored.getAuthentication().getName()).isEqualTo("user");

        mvc.perform(get("/learn/security-context").session(session))
            .andExpect(jsonPath("$.authentication.type").value("UsernamePasswordAuthenticationToken"))
            .andExpect(jsonPath("$.authentication.principalType").value("User"))
            .andExpect(jsonPath("$.authentication.authorities[0]").value("FACTOR_PASSWORD"))
            .andExpect(jsonPath("$.authentication.authorities[1]").value("ROLE_USER"))
            .andExpect(jsonPath("$.session.attributes.SPRING_SECURITY_CONTEXT").value("SecurityContextImpl"));
    }

    @Test
    void 認証の状態はセッションの属性だけで決まりリクエストをまたいで復元される() throws Exception {
        MockHttpSession loggedIn = new MockHttpSession();
        login(loggedIn, "user");

        // 別のセッション (= 別のブラウザ) に SecurityContext をそのまま移すと、ログイン済みとして扱われる。
        // SecurityContextHolderFilter が毎回 SecurityContextRepository から復元しているため。
        MockHttpSession another = new MockHttpSession();
        another.setAttribute(CONTEXT_ATTR, loggedIn.getAttribute(CONTEXT_ATTR));
        mvc.perform(get("/learn/security-context").session(another))
            .andExpect(jsonPath("$.authentication.name").value("user"));

        // 属性を消せば、同じセッション ID でも未ログインに戻る
        loggedIn.removeAttribute(CONTEXT_ATTR);
        mvc.perform(get("/learn/security-context").session(loggedIn))
            .andExpect(jsonPath("$.authentication.type").value("AnonymousAuthenticationToken"));
    }

    @Test
    void ログインするとセッションIDが変わる_セッション固定化対策() throws Exception {
        MockHttpSession session = new MockHttpSession();
        // 未ログインでも、元のリクエストを覚えるためにセッションが作られる
        authorizeRequest(session);
        String before = session.getId();

        var res = login(session, "user").andReturn();
        System.out.println("DBG before=" + before + " after=" + session.getId() + " reqSession=" + res.getRequest().getSession(false).getId() + " same=" + (res.getRequest().getSession(false) == session) + " wrapper=" + res.getRequest().getClass());

        assertThat(session.getId()).isNotEqualTo(before);
        // 変わるのは ID だけで、属性 (覚えておいたリクエスト) は引き継がれる
        assertThat(session.getAttribute(SAVED_REQUEST_ATTR)).isNotNull();
    }

    // ---- 未認証時の流れ ----

    @Test
    void 未ログインで認可エンドポイントに来るとリクエストがセッションに保存されログインへ送られる() throws Exception {
        MockHttpSession session = new MockHttpSession();

        authorizeRequest(session)
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login"));

        assertThat(session.getAttribute(SAVED_REQUEST_ATTR)).isNotNull();
        assertThat(session.getAttribute(CONTEXT_ATTR)).isNull();
    }

    @Test
    void ログインに成功すると保存されたリクエストの元のURLへ戻る() throws Exception {
        MockHttpSession session = new MockHttpSession();
        authorizeRequest(session);

        String location = login(session, "user")
            .andExpect(status().is3xxRedirection())
            .andReturn().getResponse().getRedirectedUrl();

        // 元の /oauth2/authorize へ。末尾の continue は「保存済みリクエストを再生してよい」という目印
        assertThat(location).startsWith("http://localhost/oauth2/authorize?response_type=code&client_id=web-client");
        assertThat(location).endsWith("&continue");
    }

    @Test
    void 戻ってきたリクエストが処理されると保存されたリクエストは消える() throws Exception {
        MockHttpSession session = new MockHttpSession();
        authorizeRequest(session);
        String location = login(session, "user").andReturn().getResponse().getRedirectedUrl();
        assertThat(session.getAttribute(SAVED_REQUEST_ATTR)).isNotNull();

        // ブラウザがリダイレクトに従う。ログイン済みなので認可コードつきで client へ戻される
        mvc.perform(get(location).session(session))
            .andExpect(status().is3xxRedirection());

        assertThat(session.getAttribute(SAVED_REQUEST_ATTR)).isNull();
    }

    @Test
    void 認可されていないページに未ログインで来ても同じ仕組みでログインへ送られる() throws Exception {
        mvc.perform(get("/learn/admin"))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login"));
    }

    // ---- CSRF ----

    @Test
    void ログインフォームのPOSTはCSRFトークンが無いと403になる() throws Exception {
        // /error を開けていないと、この 403 が「ログインへのリダイレクト」に見えてしまう (本文のつまずきポイント)
        mvc.perform(post("/login").param("username", "user").param("password", "password"))
            .andExpect(status().isForbidden());
    }

    @Test
    void ログアウトのPOSTもCSRFトークンが無いと403になる() throws Exception {
        MockHttpSession session = new MockHttpSession();
        login(session, "user");

        mvc.perform(post("/logout").session(session))
            .andExpect(status().isForbidden());
        assertThat(session.getAttribute(CONTEXT_ATTR)).isNotNull();

        mvc.perform(post("/logout").session(session).with(csrf()))
            .andExpect(status().is3xxRedirection());
        assertThat(session.isInvalid()).isTrue();
    }

    @Test
    void プロトコルエンドポイントはCSRFの対象外でクライアント認証だけで判定される() throws Exception {
        // CSRF トークン無しでも 403 にならず、クライアント認証の失敗 (401) になる
        mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "wrong-secret"))
                .param("grant_type", "client_credentials"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("invalid_client"));
    }

    // ---- 認可 ----

    @Test
    void ROLE_ADMINが必要なURLはUSERだと403でADMINなら通る() throws Exception {
        MockHttpSession user = new MockHttpSession();
        login(user, "user");
        mvc.perform(get("/learn/admin").session(user)).andExpect(status().isForbidden());

        MockHttpSession admin = new MockHttpSession();
        login(admin, "admin");
        mvc.perform(get("/learn/admin").session(admin))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("ADMIN only"));
    }

    // ---- ヘルパー ----

    /** 既存のセッションを使って /login に POST する (formLogin() はセッションを指定できないため自前で組む)。 */
    private ResultActions login(MockHttpSession session, String username) throws Exception {
        return mvc.perform(post("/login")
            .session(session)
            .with(csrf())
            .param("username", username)
            .param("password", "password"));
    }

    /** ブラウザ (Accept: text/html) として、未ログインで認可リクエストを送る。 */
    private ResultActions authorizeRequest(MockHttpSession session) throws Exception {
        return mvc.perform(get("/oauth2/authorize")
            .session(session)
            .accept("text/html")
            .queryParam("response_type", "code")
            .queryParam("client_id", "web-client")
            .queryParam("redirect_uri", "http://127.0.0.1:8080/login/oauth2/code/idp")
            .queryParam("scope", "openid")
            .queryParam("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
            .queryParam("code_challenge_method", "S256"));
    }
}
