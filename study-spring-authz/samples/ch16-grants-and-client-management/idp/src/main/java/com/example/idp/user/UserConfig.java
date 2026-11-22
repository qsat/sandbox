package com.example.idp.user;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class UserConfig {

    /**
     * 接頭辞 ({bcrypt} など) で方式を見分けるエンコーダー。
     * 新しく保存するときは {bcrypt}、検証は接頭辞に対応した方式で行う。
     * クライアントの secret にも同じエンコーダーを使う。
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }
}
