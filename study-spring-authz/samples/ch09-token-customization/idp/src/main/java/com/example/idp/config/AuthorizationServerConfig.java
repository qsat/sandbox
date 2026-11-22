package com.example.idp.config;

import static org.springframework.security.config.Customizer.withDefaults;

import com.example.idp.token.ScopedClaims;
import com.example.idp.user.UserAccountRepository;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

/**
 * 認可サーバーとしての設定 (プロトコルエンドポイント用のチェーン、issuer、クレームの出し分け)。
 * ログイン画面などの設定は {@link WebSecurityConfig}、保管庫は {@link PersistenceConfig}。
 */
@Configuration
public class AuthorizationServerConfig {

    /** (1) OAuth 2.1 / OIDC のプロトコルエンドポイントを守るチェーン。 */
    @Bean
    @Order(1)
    SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http, ScopedClaims scopedClaims)
            throws Exception {
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
            // SPA (別オリジン) からトークンエンドポイントなどを呼べるようにする。許可するオリジンは CorsConfig
            .cors(withDefaults())
            // 未ログインのブラウザが /oauth2/authorize に来たらログイン画面へ送る
            .exceptionHandling(exceptions -> exceptions.defaultAuthenticationEntryPointFor(
                new LoginUrlAuthenticationEntryPoint("/login"),
                new MediaTypeRequestMatcher(MediaType.TEXT_HTML)));
        return http.build();
    }

    /**
     * issuer を固定する。省略するとリクエストの URL から解決されるので、
     * 127.0.0.1 で開くか localhost で開くかで ID トークンの iss が変わってしまう。
     * クライアントとリソースサーバーは、この値と iss の完全一致を検証する。
     */
    @Bean
    AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder().issuer("http://localhost:9000").build();
    }

    /** ID トークンのクレームを scope に応じて出し分ける (6 章)。 */
    @Bean
    ScopedClaims scopedClaims(UserAccountRepository userAccountRepository) {
        return new ScopedClaims(userAccountRepository);
    }

    @Bean
    OAuth2TokenCustomizer<JwtEncodingContext> idTokenCustomizer(ScopedClaims scopedClaims) {
        return scopedClaims.idTokenCustomizer();
    }
}
