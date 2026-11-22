package com.example.idp;

import static com.example.idp.FlowSupport.SPA;
import static com.example.idp.FlowSupport.SPA_REDIRECT;
import static com.example.idp.FlowSupport.VERIFIER;
import static com.example.idp.FlowSupport.WEB;
import static com.example.idp.FlowSupport.WEB_REDIRECT;
import static com.example.idp.FlowSupport.s256;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

/** 2 章の最小構成のテスト (統合後の IdP でも通ること) と、issuer の固定。 */
@SpringBootTest
@AutoConfigureMockMvc
class IdpApplicationTests {

    @Autowired
    MockMvc mvc;

    @Test
    void ディスカバリエンドポイントが公開されている() throws Exception {
        mvc.perform(get("/.well-known/openid-configuration"))
            .andExpect(status().isOk())
            // issuer は固定値。エンドポイントの URL も issuer から作られる
            .andExpect(jsonPath("$.issuer").value("http://localhost:9000"))
            .andExpect(jsonPath("$.authorization_endpoint").value("http://localhost:9000/oauth2/authorize"))
            .andExpect(jsonPath("$.token_endpoint").value("http://localhost:9000/oauth2/token"))
            .andExpect(jsonPath("$.jwks_uri").value("http://localhost:9000/oauth2/jwks"))
            .andExpect(jsonPath("$.userinfo_endpoint").value("http://localhost:9000/userinfo"));
    }

    @Test
    void ディスカバリのissuerは127_0_0_1で開いても変わらない() throws Exception {
        mvc.perform(get("/.well-known/openid-configuration").with(request -> {
                request.setServerName("127.0.0.1");
                request.setServerPort(9000);
                return request;
            }))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.issuer").value("http://localhost:9000"));
    }

    @Test
    void 未ログインで認可エンドポイントに来るとログイン画面へ送られる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);

        mvc.perform(flow.authorizeRequest(null, WEB, WEB_REDIRECT, "openid", "s", s256(VERIFIER)))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login"));
    }

    @Test
    void 認可コードフローでconfidentialクライアントがトークンを取得できる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        MockHttpSession session = flow.loginAlice();

        String code = flow.obtainCode(session, WEB, WEB_REDIRECT);

        flow.exchangeWeb(code, VERIFIER)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token_type").value("Bearer"))
            .andExpect(jsonPath("$.access_token").isNotEmpty())
            .andExpect(jsonPath("$.refresh_token").isNotEmpty())
            .andExpect(jsonPath("$.id_token").isNotEmpty());
    }

    @Test
    void ID_トークンのissはアクセスしたホスト名に関わらず固定のissuerになる() throws Exception {
        FlowSupport flow = new FlowSupport(mvc);
        String code = flow.obtainCode(flow.loginAlice(), SPA, SPA_REDIRECT, "openid");

        String body = flow.exchangeSpa(code).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        assertThat(FlowSupport.payload(JsonPath.read(body, "$.id_token")))
            .contains("\"iss\":\"http://localhost:9000\"");
    }
}
