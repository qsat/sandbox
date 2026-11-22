package com.example.idp;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.idp.user.UserAccount;
import com.example.idp.user.UserAccountDetails;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.core.session.SessionRegistryImpl;

/** 8 章: 独自の UserDetails を認可サーバーと組み合わせるときに要る性質 (DB を使わない単体テスト)。 */
class UserAccountDetailsTests {

    private static UserAccount alice() {
        return new UserAccount("u-001", "alice", "{bcrypt}hash", "Alice Example", "alice@example.com", true, true);
    }

    @Test
    void 同じidなら別のインスタンスでも等しく_idが違えば等しくない() {
        UserAccountDetails a = new UserAccountDetails(alice());
        UserAccountDetails copy = new UserAccountDetails(alice());
        UserAccountDetails other = new UserAccountDetails(
            new UserAccount("u-002", "bob", "{bcrypt}hash", "Bob Example", "bob@example.com", false, true));

        assertThat(a).isEqualTo(copy).hasSameHashCodeAs(copy).isNotEqualTo(other);
    }

    @Test
    void セッションレジストリは別のインスタンスのユーザーでもセッションを見つけられる() {
        // 認可サーバーは、DB から復元した別インスタンスのユーザーでセッションを探す。
        // 見つからないと ID トークンから sid と auth_time が消える
        SessionRegistry registry = new SessionRegistryImpl();
        registry.registerNewSession("session-1", new UserAccountDetails(alice()));

        assertThat(registry.getAllSessions(new UserAccountDetails(alice()), false)).hasSize(1);
    }

    @Test
    void 認証が済んだらパスワードハッシュが消える() {
        UserAccountDetails details = new UserAccountDetails(alice());
        assertThat(details.getPassword()).isEqualTo("{bcrypt}hash");

        details.eraseCredentials();

        assertThat(details.getPassword()).isNull();
        assertThat(details.getUsername()).isEqualTo("alice");
    }
}
