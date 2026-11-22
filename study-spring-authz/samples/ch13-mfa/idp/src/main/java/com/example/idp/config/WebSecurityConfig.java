package com.example.idp.config;

import static org.springframework.security.config.Customizer.withDefaults;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/** (2) ログイン画面など、人間が操作する画面を守るチェーン。 */
@Configuration
public class WebSecurityConfig {

    @Bean
    @Order(2)
    SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                // /error を認証必須にすると、未ログイン時の 400 や 403 のエラーページが /login へのリダイレクトに化ける
                .requestMatchers("/error").permitAll()
                .anyRequest().authenticated())
            // loginPage を指定すると既定のログイン画面は生成されない。
            // permitAll() を付けないと、ログイン画面自体が「要ログイン」になってリダイレクトが無限に続く。
            .formLogin(form -> form.loginPage("/login").permitAll())
            // ブラウザからの CORS のプリフライト (OPTIONS) は、このチェーンに来る。許可するオリジンは CorsConfig
            .cors(withDefaults());
        return http.build();
    }
}
