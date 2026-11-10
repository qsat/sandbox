package com.example.idp.user;

import java.util.Collection;
import java.util.List;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * {@link UserAccount} を Spring Security の {@link UserDetails} に見せるアダプター。
 *
 * <p>ドメインのモデルをフレームワークの型で直接継承しないのは、
 * 「ユーザー」の定義が Spring Security のバージョンや認証方式の都合に引きずられないようにするため。
 * 変換はここ 1 か所だけ。
 */
public class UserAccountDetails implements UserDetails {

    private final UserAccount account;

    public UserAccountDetails(UserAccount account) {
        this.account = account;
    }

    /** 認証済みの Authentication から元のドメインオブジェクトを取り出したいとき用。 */
    public UserAccount getAccount() {
        return account;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        // この章では権限 (ロール) を使わない。認可は scope で表す。
        return List.of(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Override
    public String getPassword() {
        return account.passwordHash();
    }

    /** Principal の名前 (Authentication#getName) になる。認可コードや同意の「誰の」はこの値で引かれる。 */
    @Override
    public String getUsername() {
        return account.username();
    }

    /** false を返すとログインが DisabledException で失敗する。 */
    @Override
    public boolean isEnabled() {
        return account.enabled();
    }
}
