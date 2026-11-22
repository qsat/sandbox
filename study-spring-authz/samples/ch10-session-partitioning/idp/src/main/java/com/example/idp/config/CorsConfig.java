package com.example.idp.config;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * SPA (別オリジン) のブラウザから IdP を呼ぶための CORS 設定。必要な最小限だけ許可する。
 *
 * <ul>
 *   <li>オリジン: SPA のオリジンだけ (idp.cors.allowed-origins で変えられる)。"*" にはしない</li>
 *   <li>パス: ブラウザの JavaScript が直接呼ぶものだけ。/oauth2/authorize や /login は画面遷移なので CORS は要らない</li>
 *   <li>Cookie などの資格情報は許可しない。SPA は Authorization ヘッダーでアクセストークンを送る</li>
 * </ul>
 */
@Configuration
public class CorsConfig {

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${idp.cors.allowed-origins:http://127.0.0.1:5173}") List<String> allowedOrigins) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(allowedOrigins);
        configuration.setAllowedMethods(List.of("GET", "POST"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        for (String path : List.of("/oauth2/token", "/userinfo", "/.well-known/openid-configuration",
                "/oauth2/jwks")) {
            source.registerCorsConfiguration(path, configuration);
        }
        return source;
    }
}
