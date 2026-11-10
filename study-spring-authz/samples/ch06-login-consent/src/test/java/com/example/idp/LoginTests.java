package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.unauthenticated;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.idp.user.UserAccountRepository;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.MessageDigestPasswordEncoder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class LoginTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    UserAccountRepository users;

    @Test
    void 自前のログイン画面が表示されCSRFトークンが埋め込まれている() throws Exception {
        mvc.perform(get("/login"))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.containsString("name=\"username\"")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("name=\"password\"")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("name=\"_csrf\"")));
    }

    @Test
    void 正しい資格情報でログインできる() throws Exception {
        mvc.perform(formLogin().user("alice").password("password"))
            .andExpect(authenticated().withUsername("alice"));
    }

    @Test
    void パスワードが違うとログイン画面にエラー付きで戻される() throws Exception {
        mvc.perform(formLogin().user("alice").password("wrong"))
            .andExpect(unauthenticated())
            .andExpect(redirectedUrl("/login?error"));

        mvc.perform(get("/login?error"))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("ログイン名またはパスワードが正しくありません")));
    }

    @Test
    void 存在しないユーザーも同じエラーになる() throws Exception {
        mvc.perform(formLogin().user("nobody").password("password"))
            .andExpect(redirectedUrl("/login?error"));
    }

    @Test
    void 無効化されたユーザーはパスワードが合っていてもログインできない() throws Exception {
        mvc.perform(formLogin().user("carol").password("password"))
            .andExpect(unauthenticated())
            .andExpect(redirectedUrl("/login?error"));
    }

    @Test
    void CSRFトークンの無いログインPOSTは拒否される() throws Exception {
        mvc.perform(post("/login").param("username", "alice").param("password", "password"))
            .andExpect(status().isForbidden());
    }

    @Test
    void ログイン後は元の認可リクエストへ戻される() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);

        // 1. 未ログインで認可リクエスト → /login へ (元のリクエストはセッションに保存される)
        MvcResult first = mvc.perform(flow.authorizeRequest("openid", "s1"))
            .andExpect(redirectedUrl("/login"))
            .andReturn();
        MockHttpSession session = (MockHttpSession) first.getRequest().getSession(false);
        assertThat(session).isNotNull();

        // 2. 同じセッションでログイン → 元の認可リクエストの URL へ戻る
        mvc.perform(post("/login").session(session).with(csrf())
                .param("username", "alice").param("password", "password"))
            .andExpect(status().is3xxRedirection())
            .andExpect(result -> {
                String location = result.getResponse().getRedirectedUrl();
                assertThat(location).contains("/oauth2/authorize?");
                assertThat(location).contains("client_id=web-client").contains("state=s1");
            });
    }

    @Test
    @SuppressWarnings("deprecation")
    void 旧形式のハッシュのユーザーはログインに成功するとbcryptに書き換わる() throws Exception {
        // 他のテストが先に bob でログインしていても大丈夫なように、旧形式の状態を作り直す
        users.save(users.findByUsername("bob").orElseThrow()
            .withPasswordHash("{SHA-256}" + new MessageDigestPasswordEncoder("SHA-256").encode("legacy-pass")));
        assertThat(users.findByUsername("bob").orElseThrow().passwordHash()).startsWith("{SHA-256}");

        mvc.perform(formLogin().user("bob").password("legacy-pass"))
            .andExpect(authenticated().withUsername("bob"));

        assertThat(users.findByUsername("bob").orElseThrow().passwordHash()).startsWith("{bcrypt}");

        // 書き換わったあとも同じパスワードでログインできる
        mvc.perform(formLogin().user("bob").password("legacy-pass"))
            .andExpect(authenticated().withUsername("bob"));
    }
}
