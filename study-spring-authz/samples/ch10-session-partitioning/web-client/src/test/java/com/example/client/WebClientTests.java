package com.example.client;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Web クライアントのテスト。IdP を起動せずに済むよう、クライアント登録はテスト用に自前で作る
 * (application.yml の issuer-uri は起動時に IdP へ問い合わせるため)。
 * IdP と実際につないだ確認は e2e/ のスクリプトで行う。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(WebClientTests.TestRegistrations.class)
class WebClientTests {

    @TestConfiguration
    static class TestRegistrations {
        @Bean
        ClientRegistrationRepository clientRegistrationRepository() {
            return new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("idp")
                .clientId("web-client")
                .clientSecret("web-client-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope("openid", "profile", "email", "api.read")
                .authorizationUri("http://localhost:9000/oauth2/authorize")
                .tokenUri("http://localhost:9000/oauth2/token")
                .jwkSetUri("http://localhost:9000/oauth2/jwks")
                .userNameAttributeName("sub")
                .build());
        }
    }

    @Autowired
    MockMvc mvc;

    @Test
    void 未ログインのホームにはログインリンクが出る() throws Exception {
        mvc.perform(get("/"))
            .andExpect(status().isOk())
            .andExpect(content().string(containsString("/oauth2/authorization/idp")));
    }

    @Test
    void 未ログインでAPI呼び出し画面を開くとログインの入口へ送られる() throws Exception {
        mvc.perform(get("/api-call"))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/oauth2/authorization/idp"));
    }

    @Test
    void 認可リクエストにはPKCEとscopeとredirect_uriが付く() throws Exception {
        String location = mvc.perform(get("/oauth2/authorization/idp"))
            .andExpect(status().is3xxRedirection())
            .andReturn().getResponse().getRedirectedUrl();

        org.assertj.core.api.Assertions.assertThat(location)
            .startsWith("http://localhost:9000/oauth2/authorize?")
            .contains("response_type=code", "client_id=web-client", "code_challenge_method=S256", "code_challenge=",
                "scope=openid%20profile%20email%20api.read", "state=", "nonce=",
                "redirect_uri=http://localhost/login/oauth2/code/idp");
    }

    @Test
    void 既定のリゾルバーのままでconfidentialクライアントの認可リクエストにもPKCEが付く(
            @Autowired ClientRegistrationRepository registrations) {
        var request = new org.springframework.mock.web.MockHttpServletRequest("GET", "/oauth2/authorization/idp");
        request.setServletPath("/oauth2/authorization/idp");
        var defaultResolver = new org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver(
            registrations, "/oauth2/authorization");

        // client_secret を持つクライアントでも code_challenge が付く (7.1.2 で確認)。追加の設定は要らない
        org.assertj.core.api.Assertions.assertThat(defaultResolver.resolve(request).getAdditionalParameters())
            .containsKeys("code_challenge", "code_challenge_method");
    }

    @Test
    void セッションCookieの名前はWEBCLIENT_SESSIONに設定されている(@Autowired org.springframework.core.env.Environment env) {
        org.assertj.core.api.Assertions.assertThat(env.getProperty("server.servlet.session.cookie.name"))
            .isEqualTo("WEBCLIENT_SESSION");
    }

    @Test
    void ログイン中はホームにIDトークンのクレームが表示される() throws Exception {
        mvc.perform(get("/").with(oidcLogin().idToken(token -> token.claim("name", "Alice Example")
                .claim("email", "alice@example.com"))))
            .andExpect(status().isOk())
            .andExpect(content().string(containsString("Alice Example")))
            .andExpect(content().string(containsString("alice@example.com")))
            .andExpect(header().doesNotExist("Location"));
    }
}
