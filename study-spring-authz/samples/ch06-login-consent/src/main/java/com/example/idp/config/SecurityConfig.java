package com.example.idp.config;

import java.util.UUID;

import com.example.idp.token.ScopedClaims;
import com.example.idp.user.UserAccountRepository;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.InMemoryOAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.InMemoryOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

/**
 * IdP の構成 (6 章: 自前のログイン画面・同意画面・scope に応じたクレーム)。
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
    SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http, ScopedClaims scopedClaims) throws Exception {
        http
            .oauth2AuthorizationServer(authorizationServer -> {
                // このチェーンの対象を「認可サーバーのエンドポイントだけ」に絞る
                http.securityMatcher(authorizationServer.getEndpointsMatcher());
                // OpenID Connect 1.0 を有効化 (ディスカバリ / UserInfo / ID トークン)。
                // UserInfo は自前のマッパーで返す (scope に応じて UserAccount の属性を出す)
                authorizationServer.oidc(oidc -> oidc
                    .userInfoEndpoint(userInfo -> userInfo.userInfoMapper(scopedClaims.userInfoMapper())));
                // 同意が必要なときの飛び先を自前の画面にする
                authorizationServer.authorizationEndpoint(endpoint -> endpoint.consentPage("/oauth2/consent"));
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
            // loginPage を指定すると既定のログイン画面は生成されない。
            // permitAll() を付けないと、ログイン画面自体が「要ログイン」になってリダイレクトが無限に続く。
            .formLogin(form -> form.loginPage("/login").permitAll());
        return http.build();
    }

    /** ID トークンのクレームを scope に応じて出し分ける。 */
    @Bean
    ScopedClaims scopedClaims(UserAccountRepository userAccountRepository) {
        return new ScopedClaims(userAccountRepository);
    }

    @Bean
    OAuth2TokenCustomizer<JwtEncodingContext> idTokenCustomizer(ScopedClaims scopedClaims) {
        return scopedClaims.idTokenCustomizer();
    }

    /**
     * 認可 (コードやトークン) と同意の保管庫。どちらもメモリ上 (7 章で JDBC にする)。
     * 同意画面のコントローラーが「前回の同意」を引くために、Bean として取り出せるようにしておく。
     */
    @Bean
    OAuth2AuthorizationService authorizationService() {
        return new InMemoryOAuth2AuthorizationService();
    }

    @Bean
    OAuth2AuthorizationConsentService authorizationConsentService() {
        return new InMemoryOAuth2AuthorizationConsentService();
    }

    /** クライアントの台帳。まずはメモリ上に 1 件だけ。 */
    @Bean
    RegisteredClientRepository registeredClientRepository(PasswordEncoder passwordEncoder) {
        RegisteredClient webClient = RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId("web-client")
            .clientName("Web Client")
            .clientSecret(passwordEncoder.encode("web-client-secret"))
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://127.0.0.1:8080/login/oauth2/code/idp")
            .scope(OidcScopes.OPENID)
            .scope(OidcScopes.PROFILE)
            .scope(OidcScopes.EMAIL)
            .clientSettings(ClientSettings.builder()
                .requireProofKey(true)
                .requireAuthorizationConsent(true)
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
