package com.example.idp.config;

import static org.springframework.security.config.Customizer.withDefaults;

import java.time.Duration;
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
import org.springframework.security.oauth2.server.authorization.InMemoryOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
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
            .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
            .formLogin(withDefaults());
        return http.build();
    }

    /** ユーザーの保管庫。まずはメモリ上に 1 人だけ。 */
    @Bean
    UserDetailsService userDetailsService(PasswordEncoder passwordEncoder) {
        return new InMemoryUserDetailsManager(
            User.withUsername("user")
                .password(passwordEncoder.encode("password"))
                .roles("USER")
                .build());
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * クライアントの台帳。種類の違う 2 件を登録する。
     * <ul>
     *   <li>web-client: confidential client (サーバーサイドの Web アプリ。client_secret を守れる)</li>
     *   <li>spa-client: public client (ブラウザで動く SPA。秘密を持てない)</li>
     * </ul>
     */
    @Bean
    RegisteredClientRepository registeredClientRepository(PasswordEncoder passwordEncoder) {
        RegisteredClient webClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            // 学習用の固定値。本番では使わない
            .clientSecret(passwordEncoder.encode("web-client-secret"))
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            // redirect_uri は登録値との完全一致で検証される
            .redirectUri("http://127.0.0.1:8080/login/oauth2/code/idp")
            .postLogoutRedirectUri("http://127.0.0.1:8080/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .clientSettings(ClientSettings.builder()
                // confidential client でも PKCE を必須にする (OAuth 2.1 の方針)
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            // 詳細は 5 章。ここでは既定値を明示しているだけ
            .tokenSettings(TokenSettings.builder()
                .authorizationCodeTimeToLive(Duration.ofMinutes(5))
                .accessTokenTimeToLive(Duration.ofMinutes(5))
                .refreshTokenTimeToLive(Duration.ofMinutes(60))
                .build())
            .build();

        RegisteredClient spaClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("spa-client")
            // public client は秘密を持たないので、クライアント認証は NONE。clientSecret も設定しない
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://127.0.0.1:5173/callback")
            .postLogoutRedirectUri("http://127.0.0.1:5173/")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .clientSettings(ClientSettings.builder()
                // public client では PKCE が唯一の防御なので必須にする (NONE のとき実際に強制もされる)
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            .build();
        return new InMemoryRegisteredClientRepository(webClient, spaClient);
    }

    /**
     * 認可の状態 (OAuth2Authorization) の保管庫。省略しても内部で作られるが、
     * テストから中身を覗けるよう Bean として公開する。メモリ上なので再起動で消える (永続化は 7 章)。
     */
    @Bean
    OAuth2AuthorizationService authorizationService() {
        return new InMemoryOAuth2AuthorizationService();
    }

    /** issuer などサーバー自身の設定。issuer を省略するとリクエストから解決される。 */
    @Bean
    AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder().build();
    }
}
