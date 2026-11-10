package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.util.UriComponentsBuilder;

@SpringBootTest
@AutoConfigureMockMvc
class IdpApplicationTests {

    private static final String REDIRECT_URI = "http://127.0.0.1:8080/login/oauth2/code/idp";

    @Autowired
    MockMvc mvc;

    @Test
    void ディスカバリエンドポイントが公開されている() throws Exception {
        mvc.perform(get("/.well-known/openid-configuration"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.issuer").value("http://localhost"))
            .andExpect(jsonPath("$.authorization_endpoint").value("http://localhost/oauth2/authorize"))
            .andExpect(jsonPath("$.token_endpoint").value("http://localhost/oauth2/token"))
            .andExpect(jsonPath("$.jwks_uri").value("http://localhost/oauth2/jwks"));
    }

    @Test
    void 未ログインで認可エンドポイントに来るとログイン画面へ送られる() throws Exception {
        mvc.perform(get("/oauth2/authorize")
                .accept("text/html")
                .queryParam("response_type", "code")
                .queryParam("client_id", "web-client")
                .queryParam("redirect_uri", REDIRECT_URI)
                .queryParam("scope", "openid")
                .queryParam("code_challenge", challenge("verifier"))
                .queryParam("code_challenge_method", "S256"))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login"));
    }

    @Test
    void 認可コードフローでトークンを取得できる() throws Exception {
        String verifier = "a-very-long-random-string-used-as-pkce-code-verifier-0123456789";

        // 0. フォームログインしてセッションを得る
        //    (user() で認証を差し込むと「いつ認証したか」が残らず、ID トークンの auth_time を作れない)
        MockHttpSession session = (MockHttpSession) mvc.perform(formLogin().user("user").password("password"))
            .andExpect(authenticated())
            .andReturn().getRequest().getSession(false);

        // 1. 認可リクエスト (ログイン済みのブラウザとして)
        MvcResult authorize = mvc.perform(get("/oauth2/authorize")
                .session(session)
                .queryParam("response_type", "code")
                .queryParam("client_id", "web-client")
                .queryParam("redirect_uri", REDIRECT_URI)
                .queryParam("scope", "openid profile")
                .queryParam("state", "xyz")
                .queryParam("code_challenge", challenge(verifier))
                .queryParam("code_challenge_method", "S256"))
            .andExpect(status().is3xxRedirection())
            .andReturn();

        String location = authorize.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(REDIRECT_URI);
        var params = UriComponentsBuilder.fromUriString(location).build().getQueryParams();
        assertThat(params.getFirst("state")).isEqualTo("xyz");
        String code = params.getFirst("code");

        // 2. トークンリクエスト (クライアントとして)
        mvc.perform(post("/oauth2/token")
                .with(httpBasic("web-client", "web-client-secret"))
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", REDIRECT_URI)
                .param("code_verifier", verifier))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.refresh_token").isNotEmpty())
            .andExpect(jsonPath("$.id_token").isNotEmpty())
            .andExpect(jsonPath("$.token_type").value("Bearer"));
    }

    private static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
