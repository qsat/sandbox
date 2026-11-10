package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;

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

@SpringBootTest
@AutoConfigureMockMvc
class ScopedClaimsTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    OAuth2AuthorizationConsentService consentService;

    @Autowired
    RegisteredClientRepository clients;

    FlowSupport flow;

    @BeforeEach
    void setUp() {
        flow = new FlowSupport(mvc);
        OAuth2AuthorizationConsent previous = consentService.findById(clients.findByClientId("web-client").getId(), "alice");
        if (previous != null) {
            consentService.remove(previous);
        }
    }

    /** ログイン → 同意 (approved の scope だけ) → コード交換 までを行い、トークンレスポンスを返す。 */
    private String tokenResponse(String requestedScope, String... approved) throws Exception {
        MockHttpSession session = flow.login("alice", "password");
        var authorize = flow.authorize(session, requestedScope, "s1");
        String location = authorize.getResponse().getRedirectedUrl();
        if (location.startsWith("http://localhost/oauth2/consent")) {
            location = flow.submitConsent(session, FlowSupport.queryParam(location, "state"), approved)
                .getResponse().getRedirectedUrl();
        }
        return flow.exchange(FlowSupport.queryParam(location, "code"));
    }

    private String userInfo(String accessToken) throws Exception {
        return mvc.perform(get("/userinfo").header("Authorization", "Bearer " + accessToken))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    }

    @Test
    void openidだけならIDトークンにも_userinfoにも標準の識別子しか載らない() throws Exception {
        String response = tokenResponse("openid");
        String idToken = FlowSupport.payload(JsonPath.read(response, "$.id_token"));

        assertThat((String) JsonPath.read(idToken, "$.sub")).isEqualTo("alice");
        assertThat(idToken).doesNotContain("\"name\"").doesNotContain("\"email\"");

        String info = userInfo(JsonPath.read(response, "$.access_token"));
        assertThat((String) JsonPath.read(info, "$.sub")).isEqualTo("alice");
        assertThat(info).doesNotContain("\"name\"").doesNotContain("\"email\"");
    }

    @Test
    void profileを許可するとnameとpreferred_usernameが載りemailは載らない() throws Exception {
        String response = tokenResponse("openid profile", "profile");
        String idToken = FlowSupport.payload(JsonPath.read(response, "$.id_token"));
        String info = userInfo(JsonPath.read(response, "$.access_token"));

        for (String json : new String[] {idToken, info}) {
            assertThat((String) JsonPath.read(json, "$.name")).isEqualTo("Alice Example");
            assertThat((String) JsonPath.read(json, "$.preferred_username")).isEqualTo("alice");
            assertThat(json).doesNotContain("\"email\"");
        }
    }

    @Test
    void emailを許可するとemailとemail_verifiedが載りnameは載らない() throws Exception {
        String response = tokenResponse("openid email", "email");
        String idToken = FlowSupport.payload(JsonPath.read(response, "$.id_token"));
        String info = userInfo(JsonPath.read(response, "$.access_token"));

        for (String json : new String[] {idToken, info}) {
            assertThat((String) JsonPath.read(json, "$.email")).isEqualTo("alice@example.com");
            assertThat((Boolean) JsonPath.read(json, "$.email_verified")).isTrue();
            assertThat(json).doesNotContain("\"name\"");
        }
    }

    @Test
    void 要求しても同意しなかったscopeのクレームは載らない() throws Exception {
        String response = tokenResponse("openid profile email", "profile");
        String idToken = FlowSupport.payload(JsonPath.read(response, "$.id_token"));
        String info = userInfo(JsonPath.read(response, "$.access_token"));

        assertThat(idToken).contains("\"name\"").doesNotContain("\"email\"");
        assertThat(info).contains("\"name\"").doesNotContain("\"email\"");
    }
}
