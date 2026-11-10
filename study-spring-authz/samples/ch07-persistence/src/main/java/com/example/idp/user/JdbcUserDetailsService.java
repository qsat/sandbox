package com.example.idp.user;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;

/**
 * 自前の users テーブル (app_user / app_user_role) を引く UserDetailsService。
 *
 * <p>JdbcUserDetailsManager は標準のテーブル定義 (users / authorities) を前提にする。
 * 列を増やしたい (メールアドレス、MFA の設定など) 場合は、こうして自前で実装するほうが素直。
 */
@Component
public class JdbcUserDetailsService implements UserDetailsService {

    private final JdbcTemplate jdbcTemplate;

    public JdbcUserDetailsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        List<UserRow> rows = jdbcTemplate.query(
            "SELECT username, password, enabled FROM app_user WHERE username = ?",
            (rs, i) -> new UserRow(rs.getString("username"), rs.getString("password"), rs.getBoolean("enabled")),
            username);
        if (rows.isEmpty()) {
            throw new UsernameNotFoundException("user not found: " + username);
        }
        UserRow row = rows.get(0);
        List<SimpleGrantedAuthority> authorities = jdbcTemplate.query(
            "SELECT role FROM app_user_role WHERE username = ?",
            // User.roles() と同じ規約で ROLE_ を付ける
            (rs, i) -> new SimpleGrantedAuthority("ROLE_" + rs.getString("role")),
            username);
        return User.withUsername(row.username())
            .password(row.password())
            .disabled(!row.enabled())
            .authorities(authorities)
            .build();
    }

    private record UserRow(String username, String password, boolean enabled) {
    }
}
