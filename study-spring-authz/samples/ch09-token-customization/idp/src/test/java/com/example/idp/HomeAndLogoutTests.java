package com.example.idp;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

/** IdP 自身のホーム画面と、IdP からのログアウト (IdP のセッションを終わらせる)。 */
@SpringBootTest
@AutoConfigureMockMvc
class HomeAndLogoutTests {

    @Autowired
    MockMvc mvc;

    @Test
    void 未ログインでホームを開くとログイン画面へ送られる() throws Exception {
        mvc.perform(get("/")).andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/login"));
    }

    @Test
    void ログイン中はホームにログイン中のユーザーが表示される() throws Exception {
        MockHttpSession session = new FlowSupport(mvc).loginAlice();

        mvc.perform(get("/").session(session))
            .andExpect(status().isOk())
            .andExpect(content().string(containsString("Alice Example")))
            .andExpect(content().string(containsString("name=\"_csrf\"")));
    }

    @Test
    void 直接ログインしたあとの飛び先はホームで_404にならない() throws Exception {
        // 保存された元のリクエストが無いとき、ログイン成功後は "/" へ送られる
        mvc.perform(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders
                .formLogin("/login").user("alice").password("password"))
            .andExpect(redirectedUrl("/"));
    }

    @Test
    void IdPからログアウトするとセッションが終わりホームを開けなくなる() throws Exception {
        MockHttpSession session = new FlowSupport(mvc).loginAlice();

        mvc.perform(post("/logout").session(session).with(csrf()))
            .andExpect(redirectedUrl("/login?logout"));

        mvc.perform(get("/").session(session)).andExpect(status().is3xxRedirection());
    }
}
