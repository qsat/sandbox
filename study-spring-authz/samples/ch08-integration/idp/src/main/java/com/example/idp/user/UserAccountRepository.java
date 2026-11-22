package com.example.idp.user;

import java.util.Optional;

/**
 * ユーザーの保管庫。実装を差し替えられるようにインターフェースにしておく (7 章で JDBC 実装にする)。
 */
public interface UserAccountRepository {

    Optional<UserAccount> findByUsername(String username);

    void save(UserAccount account);
}
