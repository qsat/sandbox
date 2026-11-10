package com.example.idp.config;

import static org.springframework.security.config.Customizer.withDefaults;

import java.util.UUID;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

/**
 * IdP の最小構成。
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
            .authorizeHttpRequests(authorize -> authorize
                // 認可の観察用 (第3章): 先に書いたルールが優先される。具体的なルールを上、anyRequest を最後に置く
                .requestMatchers("/learn/admin").hasRole("ADMIN")
                // 未ログインの状態 (AnonymousAuthenticationToken) も観察できるよう、学習用エンドポイントだけ開けている
                .requestMatchers("/learn/security-context", "/learn/filters").permitAll()
                // /error を開けておかないと、CSRF 失敗などの 403 が「ログイン画面へのリダイレクト」に化ける (第3章 つまずきポイント)
                .requestMatchers("/error").permitAll()
                .anyRequest().authenticated())
            .formLogin(withDefaults());
        return http.build();
    }

    /** ユーザーの保管庫。まずはメモリ上に学習用の 2 人だけ。 */
    @Bean
    UserDetailsService userDetailsService(PasswordEncoder passwordEncoder) {
        return new InMemoryUserDetailsManager(
            User.withUsername("user")
                .password(passwordEncoder.encode("password"))
                .roles("USER")
                .build(),
            // 認可の観察用 (第3章): ROLE_ADMIN を持つ学習用ユーザー。本番には置かない
            User.withUsername("admin")
                .password(passwordEncoder.encode("password"))
                .roles("USER", "ADMIN")
                .build());
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /** クライアントの台帳。まずはメモリ上に 1 件だけ。 */
    @Bean
    RegisteredClientRepository registeredClientRepository(PasswordEncoder passwordEncoder) {
        RegisteredClient webClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            .clientSecret(passwordEncoder.encode("web-client-secret"))
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
            .build();
        return new InMemoryRegisteredClientRepository(webClient);
    }

    /** issuer などサーバー自身の設定。issuer を省略するとリクエストから解決される。 */
    @Bean
    AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder().build();
    }
}
