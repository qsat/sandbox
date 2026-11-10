package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsent;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class ConsentTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    OAuth2AuthorizationConsentService consentService;

    @Autowired
    RegisteredClientRepository clients;

    FlowSupport flow;
    String clientRegistrationId;

    @BeforeEach
    void setUp() {
        flow = new FlowSupport(mvc);
        clientRegistrationId = clients.findByClientId("web-client").getId();
        // コンテキストはテスト間で共有されるので、前のテストの同意を消しておく
        OAuth2AuthorizationConsent previous = consentService.findById(clientRegistrationId, "alice");
        if (previous != null) {
            consentService.remove(previous);
        }
    }

    @Test
    void 同意が必要な認可リクエストは自前の同意画面へリダイレクトされる() throws Exception {
        MockHttpSession session = flow.login("alice", "password");

        MvcResult result = flow.authorize(session, "openid profile", "s1");

        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        String location = result.getResponse().getRedirectedUrl();
        assertThat(location).startsWith("http://localhost/oauth2/consent?");
        assertThat(FlowSupport.queryParam(location, "client_id")).isEqualTo("web-client");
        assertThat(FlowSupport.queryParam(location, "scope")).isEqualTo("openid profile");
        // state は元のクライアントの state ("s1") ではなく、同意リクエストを特定する認可サーバー発行の値
        assertThat(FlowSupport.queryParam(location, "state")).isNotEqualTo("s1").isNotBlank();
    }

    @Test
    void 同意画面にはopenid以外のscopeがチェックボックスで並ぶ() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile email", "s1"));

        mvc.perform(get("/oauth2/consent").session(session)
                .queryParam("client_id", "web-client")
                .queryParam("scope", "openid profile email")
                .queryParam("state", state))
            .andExpect(status().isOk())
            .andExpect(content().string(containsString("Web Client")))
            .andExpect(content().string(containsString("name=\"scope\" value=\"profile\"")))
            .andExpect(content().string(containsString("name=\"scope\" value=\"email\"")))
            .andExpect(content().string(not(containsString("value=\"openid\""))))
            .andExpect(content().string(containsString("name=\"_csrf\"")))
            .andExpect(content().string(containsString("action=\"/oauth2/authorize\"")));
    }

    @Test
    void 同意すると認可コードが発行され同意が保存される() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile email", "s1"));

        MvcResult approved = flow.submitConsent(session, state, "profile", "email");

        String location = approved.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(FlowSupport.REDIRECT_URI);
        assertThat(FlowSupport.queryParam(location, "code")).isNotBlank();
        assertThat(FlowSupport.queryParam(location, "state")).isEqualTo("s1");

        OAuth2AuthorizationConsent saved = consentService.findById(clientRegistrationId, "alice");
        assertThat(saved).isNotNull();
        // openid は画面で選ばせていないが、承認済みとして一緒に保存される
        assertThat(saved.getScopes()).containsExactlyInAnyOrder("openid", "profile", "email");
    }

    @Test
    void 同意済みのscopeなら2回目以降は同意画面が出ない() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile", "s1"));
        flow.submitConsent(session, state, "profile");

        MvcResult second = flow.authorize(session, "openid profile", "s2");

        String location = second.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(FlowSupport.REDIRECT_URI);
        assertThat(FlowSupport.queryParam(location, "code")).isNotBlank();
        assertThat(FlowSupport.queryParam(location, "state")).isEqualTo("s2");
    }

    @Test
    void 同意済みより多くのscopeを求めると差分だけ同意画面に出る() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile", "s1"));
        flow.submitConsent(session, state, "profile");

        MvcResult second = flow.authorize(session, "openid profile email", "s2");
        String location = second.getResponse().getRedirectedUrl();
        assertThat(location).startsWith("http://localhost/oauth2/consent?");

        mvc.perform(get("/oauth2/consent").session(session)
                .queryParam("client_id", "web-client")
                .queryParam("scope", "openid profile email")
                .queryParam("state", FlowSupport.queryParam(location, "state")))
            .andExpect(content().string(containsString("name=\"scope\" value=\"email\"")))
            .andExpect(content().string(not(containsString("name=\"scope\" value=\"profile\""))))
            .andExpect(content().string(containsString("すでに許可済みの権限")));
    }

    @Test
    void 一部のscopeだけ同意すると同意した分だけが保存されトークンにも反映される() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile email", "s1"));

        MvcResult approved = flow.submitConsent(session, state, "profile");

        assertThat(consentService.findById(clientRegistrationId, "alice").getScopes())
            .containsExactlyInAnyOrder("openid", "profile");
        String code = FlowSupport.queryParam(approved.getResponse().getRedirectedUrl(), "code");
        String tokenResponse = flow.exchange(code);
        assertThat(tokenResponse).contains("\"scope\":\"openid profile\"");
    }

    @Test
    void 拒否するとaccess_deniedでクライアントに戻り同意は保存されない() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile", "s1"));

        MvcResult denied = flow.submitConsent(session, state);

        String location = denied.getResponse().getRedirectedUrl();
        assertThat(location).startsWith(FlowSupport.REDIRECT_URI);
        assertThat(FlowSupport.queryParam(location, "error")).isEqualTo("access_denied");
        assertThat(FlowSupport.queryParam(location, "state")).isEqualTo("s1");
        assertThat(FlowSupport.queryParam(location, "code")).isNull();
        assertThat(consentService.findById(clientRegistrationId, "alice")).isNull();
    }

    @Test
    void 同意済みのscopeがある状態で拒否してもエラーにならず済みの範囲でコードが出る() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String first = FlowSupport.stateOf(flow.authorize(session, "openid profile", "s1"));
        flow.submitConsent(session, first, "profile");

        // email を追加で求められて「拒否」する。profile は前回すでに同意済み
        String second = FlowSupport.stateOf(flow.authorize(session, "openid profile email", "s2"));
        MvcResult denied = flow.submitConsent(session, second);

        // 認可サーバーは「前回の同意 + 今回の選択」が空でなければ拒否扱いにしない
        String location = denied.getResponse().getRedirectedUrl();
        assertThat(FlowSupport.queryParam(location, "error")).isNull();
        String tokenResponse = flow.exchange(FlowSupport.queryParam(location, "code"));
        assertThat(tokenResponse).contains("\"scope\":\"openid profile\"");
        assertThat(consentService.findById(clientRegistrationId, "alice").getScopes())
            .containsExactlyInAnyOrder("openid", "profile");
    }

    @Test
    void 要求していないscopeを同意として送るとinvalid_scopeになる() throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(session, "openid profile", "s1"));

        MvcResult tampered = flow.submitConsent(session, state, "profile", "email");

        assertThat(FlowSupport.queryParam(tampered.getResponse().getRedirectedUrl(), "error"))
            .isEqualTo("invalid_scope");
        assertThat(consentService.findById(clientRegistrationId, "alice")).isNull();
    }

    @Test
    void openidだけのリクエストは同意画面を出さずにコードを発行する() throws Exception {
        MockHttpSession session = flow.login("alice", "password");

        MvcResult result = flow.authorize(session, "openid", "s1");

        assertThat(result.getResponse().getRedirectedUrl()).startsWith(FlowSupport.REDIRECT_URI + "?code=");
        assertThat(consentService.findById(clientRegistrationId, "alice")).isNull();
    }

    @Test
    void 同意は別のユーザーには引き継がれない() throws Exception {
        MockHttpSession alice = flow.login("alice", "password");
        String state = FlowSupport.stateOf(flow.authorize(alice, "openid profile", "s1"));
        flow.submitConsent(alice, state, "profile");

        MockHttpSession bob = flow.login("bob", "legacy-pass");
        MvcResult result = flow.authorize(bob, "openid profile", "s1");

        assertThat(result.getResponse().getRedirectedUrl()).startsWith("http://localhost/oauth2/consent?");
        assertThat(consentService.findById(clientRegistrationId, "bob")).isNull();
        assertThat(Set.of(consentService.findById(clientRegistrationId, "alice").getPrincipalName()))
            .containsExactly("alice");
    }
}
