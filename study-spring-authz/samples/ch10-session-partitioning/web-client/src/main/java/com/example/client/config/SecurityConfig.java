package com.example.client.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Web クライアントのログイン設定。ログインは IdP に任せ (oauth2Login)、ログアウトはこのアプリのセッションを消すだけ。
 *
 * <p>PKCE の設定は書いていない。Spring Security 7.1.2 の oauth2Login は、client_secret を持つクライアントにも
 * 既定で code_challenge (S256) を付ける (WebClientTests で確認)。IdP は web-client にも PKCE を必須にしているので、
 * 何も設定しなくても噛み合う。
 */
@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                .requestMatchers("/", "/error").permitAll()
                .anyRequest().authenticated())
            .oauth2Login(Customizer.withDefaults())
            // POST /logout で、このアプリのセッション (WEBCLIENT_SESSION) を消す。IdP のセッションは消えない (連動は 12 章)
            .logout(logout -> logout.logoutSuccessUrl("/"));
        return http.build();
    }
}
