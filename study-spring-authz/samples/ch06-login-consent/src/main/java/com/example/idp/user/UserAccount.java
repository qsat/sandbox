package com.example.idp.user;

import java.io.Serializable;

/**
 * IdP が管理するユーザーのドメインモデル。
 *
 * <p>Spring Security の型 (UserDetails) には依存させない。
 * 「ユーザーとは何か」は IdP の業務の言葉で決め、フレームワークとの接続は
 * {@link UserAccountDetails} に閉じ込める。
 *
 * <p>セッションや認可情報に載って直列化される可能性があるので Serializable にしている (7 章の永続化で効く)。
 *
 * @param id           変更されない内部 ID (将来 sub に使う候補)
 * @param username     ログイン名 (変更されうる)
 * @param passwordHash 接頭辞付きのハッシュ ({bcrypt}... の形式)。平文は持たない
 * @param displayName  表示名 (name クレームの元)
 * @param email        メールアドレス
 * @param emailVerified メールアドレスの所有確認が済んでいるか
 * @param enabled      false ならログインさせない
 */
public record UserAccount(
        String id,
        String username,
        String passwordHash,
        String displayName,
        String email,
        boolean emailVerified,
        boolean enabled) implements Serializable {

    /** パスワードハッシュだけ差し替えた新しいインスタンス (record は不変なので copy で表現する)。 */
    public UserAccount withPasswordHash(String newPasswordHash) {
        return new UserAccount(id, username, newPasswordHash, displayName, email, emailVerified, enabled);
    }
}
