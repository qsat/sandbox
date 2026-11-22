package com.example.resource.config;

import static org.springframework.security.config.Customizer.withDefaults;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * リソースサーバーの設定。受け取ったアクセストークン (JWT) を検証して、scope で API を守る。
 *
 * <p>JWT の検証 (署名・exp・iss) は、application.yml の issuer-uri / jwk-set-uri から Spring Boot が
 * JwtDecoder を自動で作って行う。ここでは「どの URL にどの scope を要求するか」だけを書く。
 */
@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain apiSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                // scope claim は "SCOPE_" を付けた権限になる (api.read → SCOPE_api.read)
                .requestMatchers("/api/notes").hasAuthority("SCOPE_api.read")
                // /api/me は有効なトークンならどの scope でも呼べる
                .requestMatchers("/api/**").authenticated()
                .anyRequest().denyAll())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()))
            // Cookie を使わず毎回トークンで認証する API なので、セッションは作らない
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // CSRF はブラウザが Cookie を自動送信することを悪用する攻撃。Authorization ヘッダーは自動では付かないので不要
            .csrf(AbstractHttpConfigurer::disable)
            .cors(withDefaults());
        return http.build();
    }
}
