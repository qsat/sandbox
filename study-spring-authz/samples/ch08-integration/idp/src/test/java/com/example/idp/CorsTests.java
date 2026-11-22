package com.example.idp;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** SPA (http://127.0.0.1:5173) から IdP を呼ぶための CORS。必要な最小限だけ許可していること。 */
@SpringBootTest
@AutoConfigureMockMvc
class CorsTests {

    private static final String SPA_ORIGIN = "http://127.0.0.1:5173";

    @Autowired
    MockMvc mvc;

    @Test
    void トークンエンドポイントのプリフライトはSPAのオリジンに許可される() throws Exception {
        mvc.perform(options("/oauth2/token")
                .header("Origin", SPA_ORIGIN)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", SPA_ORIGIN))
            .andExpect(header().string("Access-Control-Allow-Methods", "GET,POST"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void UserInfoのプリフライトはAuthorizationヘッダーを許可する() throws Exception {
        mvc.perform(options("/userinfo")
                .header("Origin", SPA_ORIGIN)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", SPA_ORIGIN));
    }

    @Test
    void ディスカバリとJWKはSPAのオリジンからの読み取りが許可される() throws Exception {
        for (String path : new String[] { "/.well-known/openid-configuration", "/oauth2/jwks" }) {
            mvc.perform(get(path).header("Origin", SPA_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", SPA_ORIGIN));
        }
    }

    @Test
    void 別のオリジンは許可されない() throws Exception {
        mvc.perform(options("/oauth2/token")
                .header("Origin", "http://evil.example")
                .header("Access-Control-Request-Method", "POST"))
            .andExpect(status().isForbidden())
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void 画面遷移で使うエンドポイントにはCORSを許可しない() throws Exception {
        // /oauth2/authorize や /login はブラウザの画面遷移で使うもので、JavaScript から呼ばせる必要がない
        mvc.perform(options("/oauth2/authorize")
                .header("Origin", SPA_ORIGIN)
                .header("Access-Control-Request-Method", "GET"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
