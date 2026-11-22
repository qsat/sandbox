package com.example.idp.seed;

import java.time.Duration;

import com.example.idp.client.ClientRegistrations;
import com.example.idp.user.UserAccount;
import com.example.idp.user.UserAccountRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.MessageDigestPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Component;

/**
 * 起動時の初期データ投入。何度起動しても結果が同じになる (冪等) ように、
 * 「すでにあれば何もしない」を徹底する。
 *
 * <p>学習用の固定値 (パスワードなど) を使っている。本番では使わないこと。
 * すでに DB にあるデータは書き換えない。定義を変えたときは DB を作り直す (mvn clean)。
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private final RegisteredClientRepository clients;
    private final UserAccountRepository users;
    private final PasswordEncoder passwordEncoder;
    private final Duration accessTokenTimeToLive;

    public DataSeeder(RegisteredClientRepository clients, UserAccountRepository users,
            PasswordEncoder passwordEncoder,
            @Value("${idp.token.access-token-ttl:PT15M}") Duration accessTokenTimeToLive) {
        this.clients = clients;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.accessTokenTimeToLive = accessTokenTimeToLive;
    }

    @Override
    public void run(ApplicationArguments args) {
        seedClients();
        seedUsers();
    }

    private void seedClients() {
        // JdbcRegisteredClientRepository.save() は「id」で新規/更新を判定する。
        // id は毎回 UUID を作るので、client_id で存在確認しないと起動のたびに別行が増える。
        if (clients.findByClientId("web-client") == null) {
            clients.save(ClientRegistrations.webClient(passwordEncoder, accessTokenTimeToLive));
        }
        if (clients.findByClientId("spa-client") == null) {
            clients.save(ClientRegistrations.spaClient(accessTokenTimeToLive));
        }
    }

    /**
     * 学習用の初期ユーザー 3 人 (6 章と同じ)。
     * <ul>
     *   <li>alice / password: 通常のユーザー ({bcrypt})</li>
     *   <li>bob / legacy-pass: 旧システムから移行してきた想定のユーザー ({SHA-256})。ログインすると {bcrypt} に書き換わる</li>
     *   <li>carol / password: 無効化されたユーザー</li>
     * </ul>
     */
    @SuppressWarnings("deprecation") // SHA-256 は「古い方式の例」としてあえて使う
    private void seedUsers() {
        seedUser(new UserAccount("u-001", "alice", passwordEncoder.encode("password"),
            "Alice Example", "alice@example.com", true, true));
        seedUser(new UserAccount("u-002", "bob",
            "{SHA-256}" + new MessageDigestPasswordEncoder("SHA-256").encode("legacy-pass"),
            "Bob Example", "bob@example.com", false, true));
        seedUser(new UserAccount("u-003", "carol", passwordEncoder.encode("password"),
            "Carol Example", "carol@example.com", true, false));
    }

    private void seedUser(UserAccount account) {
        if (users.findByUsername(account.username()).isEmpty()) {
            users.save(account);
        }
    }
}
