package com.example.idp.config;

import static org.springframework.security.config.Customizer.withDefaults;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.JdbcRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

/**
 * IdP の設定。第7章では、クライアント・認可・同意の保管先を JDBC 実装に切り替えている。
 *
 * <p>フィルターチェーンを 2 本に分けるのが定石:
 * <ol>
 *   <li>プロトコルエンドポイント用 (/oauth2/authorize, /oauth2/token, /.well-known/** など)</li>
 *   <li>それ以外 (ログイン画面など、人間が操作する画面) 用</li>
 * </ol>
 */
@Configuration
public class SecurityConfig {

    /** (1) OAuth 2.1 / OIDC のプロトコルエンドポイントを守るチェーン。 */
    @Bean
    @Order(1)
    SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .oauth2AuthorizationServer(authorizationServer -> {
                // このチェーンの対象を「認可サーバーのエンドポイントだけ」に絞る
                http.securityMatcher(authorizationServer.getEndpointsMatcher());
                // OpenID Connect 1.0 を有効化 (ディスカバリ / UserInfo / ID トークン)
                authorizationServer.oidc(withDefaults());
            })
            .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
            // 未ログインのブラウザが /oauth2/authorize に来たらログイン画面へ送る
            .exceptionHandling(exceptions -> exceptions.defaultAuthenticationEntryPointFor(
                new LoginUrlAuthenticationEntryPoint("/login"),
                new MediaTypeRequestMatcher(MediaType.TEXT_HTML)));
        return http.build();
    }

    /** (2) ログイン画面など、ユーザー認証そのものを担当するチェーン。 */
    @Bean
    @Order(2)
    SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
            .formLogin(withDefaults());
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * クライアントの台帳。JDBC 実装なので oauth2_registered_client テーブルに保存される。
     * 登録そのもの (初期データ) は {@link com.example.idp.seed.DataSeeder} が起動時に行う。
     */
    @Bean
    RegisteredClientRepository registeredClientRepository(JdbcTemplate jdbcTemplate) {
        return new JdbcRegisteredClientRepository(jdbcTemplate);
    }

    /** 認可 (発行済みコード・トークン) の保管庫。oauth2_authorization テーブル。 */
    @Bean
    OAuth2AuthorizationService authorizationService(JdbcTemplate jdbcTemplate,
            RegisteredClientRepository registeredClientRepository) {
        return new JdbcOAuth2AuthorizationService(jdbcTemplate, registeredClientRepository);
    }

    /** 同意の保管庫。oauth2_authorization_consent テーブル。 */
    @Bean
    OAuth2AuthorizationConsentService authorizationConsentService(JdbcTemplate jdbcTemplate,
            RegisteredClientRepository registeredClientRepository) {
        return new JdbcOAuth2AuthorizationConsentService(jdbcTemplate, registeredClientRepository);
    }

    /** issuer などサーバー自身の設定。issuer を省略するとリクエストから解決される。 */
    @Bean
    AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder().build();
    }
}
