package com.example.idp.user;

import java.util.Collection;
import java.util.List;

import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * {@link UserAccount} を Spring Security の {@link UserDetails} に見せるアダプター。
 *
 * <p>ドメインのモデルをフレームワークの型で直接継承しないのは、
 * 「ユーザー」の定義が Spring Security のバージョンや認証方式の都合に引きずられないようにするため。
 * 変換はここ 1 か所だけ。
 *
 * <p>JDBC の認可サービス (OAuth2AuthorizationService) は、ログイン中のユーザー (この型) を
 * 認可の attributes に JSON で保存する。そのために次の 2 つが要る (8 章)。
 * <ul>
 *   <li>{@link CredentialsContainer}: 認証が済むと Spring Security がパスワードを消す。
 *       これを実装しないと、パスワードハッシュが DB の attributes に残る</li>
 *   <li>Jackson の許可リストと Mixin への登録: {@link UserAccountDetailsMixin}、{@link com.example.idp.config.PersistenceConfig}</li>
 *   <li>equals / hashCode: 認可サーバーは、ログイン中のセッション (SessionRegistry) をユーザーオブジェクトをキーにして探し、
 *       ID トークンの sid と auth_time を決める。DB から復元したオブジェクトは別のインスタンスなので、
 *       これを定義しないとキーが一致せず、sid と auth_time が ID トークンから消える</li>
 * </ul>
 */
public class UserAccountDetails implements UserDetails, CredentialsContainer {

    // eraseCredentials() で差し替えるので final にしない
    private UserAccount account;

    public UserAccountDetails(UserAccount account) {
        this.account = account;
    }

    /** 認証が済んだらパスワードハッシュを手放す (User クラスと同じ振る舞い)。 */
    @Override
    public void eraseCredentials() {
        this.account = account.withPasswordHash(null);
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

    /** 同じユーザー (id が同じ) なら等しい。ログイン名が変わっても、内部 ID が同じなら同じユーザー。 */
    @Override
    public boolean equals(Object other) {
        return other instanceof UserAccountDetails that && account.id().equals(that.account.id());
    }

    @Override
    public int hashCode() {
        return account.id().hashCode();
    }
}
