package com.example.idp.user;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.MessageDigestPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** ユーザー関連の Bean と、学習用の初期データ。 */
@Configuration
public class UserConfig {

    /**
     * 接頭辞 ({bcrypt} など) で方式を見分けるエンコーダー。
     * 新しく保存するときは {bcrypt}、検証は接頭辞に対応した方式で行う。
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * 学習用の初期ユーザー 3 人。本番では使えない (パスワードがソースに書いてある)。
     * <ul>
     *   <li>alice / password: 通常のユーザー ({bcrypt})</li>
     *   <li>bob / legacy-pass: 旧システムから移行してきた想定のユーザー ({SHA-256})。ログインすると {bcrypt} に書き換わる</li>
     *   <li>carol / password: 無効化されたユーザー</li>
     * </ul>
     */
    @Bean
    @SuppressWarnings("deprecation") // SHA-256 は「古い方式の例」としてあえて使う
    UserAccountRepository userAccountRepository(PasswordEncoder passwordEncoder) {
        InMemoryUserAccountRepository repository = new InMemoryUserAccountRepository();
        repository.save(new UserAccount("u-001", "alice", passwordEncoder.encode("password"),
            "Alice Example", "alice@example.com", true, true));
        repository.save(new UserAccount("u-002", "bob",
            "{SHA-256}" + new MessageDigestPasswordEncoder("SHA-256").encode("legacy-pass"),
            "Bob Example", "bob@example.com", false, true));
        repository.save(new UserAccount("u-003", "carol", passwordEncoder.encode("password"),
            "Carol Example", "carol@example.com", true, false));
        return repository;
    }
}
