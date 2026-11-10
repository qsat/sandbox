package com.example.idp.seed;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 起動時の初期データ投入。何度起動しても結果が同じになる (冪等) ように、
 * 「すでにあれば何もしない」を徹底する。
 *
 * <p>学習用の固定値 (web-client-secret, password) を使っている。本番では使わないこと。
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private final RegisteredClientRepository clients;
    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(RegisteredClientRepository clients, JdbcTemplate jdbcTemplate,
            PasswordEncoder passwordEncoder) {
        this.clients = clients;
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        seedClient();
        seedUser("user", "password", "USER");
    }

    private void seedClient() {
        // JdbcRegisteredClientRepository.save() は「id」で新規/更新を判定する。
        // id は毎回 UUID を作るので、client_id で存在確認しないと起動のたびに別行が増える。
        if (clients.findByClientId("web-client") != null) {
            return;
        }
        clients.save(RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            // client_secret は必ずハッシュにして保存する (DB が漏れても元の値が分からないように)
            .clientSecret(passwordEncoder.encode("web-client-secret"))
            .clientName("Web Client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://127.0.0.1:8080/login/oauth2/code/idp")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .clientSettings(ClientSettings.builder()
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            .build());
    }

    private void seedUser(String username, String rawPassword, String role) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM app_user WHERE username = ?", Integer.class, username);
        if (count != null && count > 0) {
            return;
        }
        jdbcTemplate.update("INSERT INTO app_user (username, password, enabled) VALUES (?, ?, TRUE)",
            username, passwordEncoder.encode(rawPassword));
        jdbcTemplate.update("INSERT INTO app_user_role (username, role) VALUES (?, ?)", username, role);
    }
}
