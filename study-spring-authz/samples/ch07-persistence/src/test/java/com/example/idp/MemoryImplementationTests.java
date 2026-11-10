package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.server.authorization.InMemoryOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import com.jayway.jsonpath.JsonPath;

/**
 * 比較用: 認可の保管庫だけをメモリ実装に戻すと、再起動相当でリフレッシュが失敗することを確かめる。
 * (DB は同じものを共有している。違うのは認可の保管先だけ)
 */
@SpringBootTest(properties = "spring.main.allow-bean-definition-overriding=true")
@AutoConfigureMockMvc
@Import(MemoryImplementationTests.MemoryAuthorizationConfig.class)
class MemoryImplementationTests {

    @TestConfiguration
    static class MemoryAuthorizationConfig {
        // SecurityConfig の authorizationService (JDBC) を同名のメモリ実装で上書きする
        @Bean
        OAuth2AuthorizationService authorizationService() {
            return new InMemoryOAuth2AuthorizationService();
        }
    }

    @Autowired
    MockMvc mvc;

    @Test
    void 認可をメモリに持つと再起動相当でリフレッシュがinvalid_grantになる() throws Exception {
        String refreshToken = JsonPath.read(AuthorizationFlow.run(mvc), "$.refresh_token");

        try (ConfigurableApplicationContext restarted = new SpringApplicationBuilder(IdpApplication.class,
                MemoryAuthorizationConfig.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.port=0", "spring.main.allow-bean-definition-overriding=true")
                .run()) {
            int port = ((WebServerApplicationContext) restarted).getWebServer().getPort();
            RestClient client = RestClient.builder().baseUrl("http://localhost:" + port).build();
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("grant_type", "refresh_token");
            form.add("refresh_token", refreshToken);

            assertThatThrownBy(() -> client.post().uri("/oauth2/token")
                    .headers(h -> h.setBasicAuth("web-client", "web-client-secret"))
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve().body(String.class))
                .hasMessageContaining("400")
                .hasMessageContaining("invalid_grant");
        }
        assertThat(refreshToken).isNotBlank();
    }
}
