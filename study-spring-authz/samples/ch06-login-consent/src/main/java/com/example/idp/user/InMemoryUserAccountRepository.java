package com.example.idp.user;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** メモリ上のリポジトリ。再起動すると消える。学習用。 */
public class InMemoryUserAccountRepository implements UserAccountRepository {

    private final Map<String, UserAccount> byUsername = new ConcurrentHashMap<>();

    @Override
    public Optional<UserAccount> findByUsername(String username) {
        return Optional.ofNullable(byUsername.get(username));
    }

    @Override
    public void save(UserAccount account) {
        byUsername.put(account.username(), account);
    }
}
