package com.example.idp.user;

import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * {@link UserAccount} を app_user テーブルに保存する実装 (6 章のメモリ実装を差し替える)。
 *
 * <p>JdbcUserDetailsManager は標準のテーブル定義 (users / authorities) を前提にするので使わない。
 * 列を自由に決めたいので、素の JdbcTemplate で書く。
 */
@Repository
public class JdbcUserAccountRepository implements UserAccountRepository {

    private static final RowMapper<UserAccount> ROW_MAPPER = (rs, i) -> new UserAccount(
        rs.getString("id"),
        rs.getString("username"),
        rs.getString("password_hash"),
        rs.getString("display_name"),
        rs.getString("email"),
        rs.getBoolean("email_verified"),
        rs.getBoolean("enabled"));

    private final JdbcTemplate jdbcTemplate;

    public JdbcUserAccountRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Optional<UserAccount> findByUsername(String username) {
        return jdbcTemplate.query("""
                SELECT id, username, password_hash, display_name, email, email_verified, enabled
                FROM app_user WHERE username = ?
                """, ROW_MAPPER, username).stream().findFirst();
    }

    /** id で新規 / 更新を判定する (id は変わらない内部 ID。ログイン名の変更は更新として扱える)。 */
    @Override
    public void save(UserAccount account) {
        int updated = jdbcTemplate.update("""
                UPDATE app_user SET username = ?, password_hash = ?, display_name = ?, email = ?,
                                    email_verified = ?, enabled = ?
                WHERE id = ?
                """, account.username(), account.passwordHash(), account.displayName(), account.email(),
            account.emailVerified(), account.enabled(), account.id());
        if (updated == 0) {
            jdbcTemplate.update("""
                    INSERT INTO app_user (id, username, password_hash, display_name, email, email_verified, enabled)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, account.id(), account.username(), account.passwordHash(), account.displayName(),
                account.email(), account.emailVerified(), account.enabled());
        }
    }
}
